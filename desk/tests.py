import json
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from .models import Lead, PlanStop, Visit


class WorkspaceTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("rep")
        self.client.force_login(self.user)
        self.url = "/api/workspace"
        self.today = timezone.localdate().isoformat()
        self.lead_id = str(uuid.uuid4())

    def state(self):
        return self.client.get(self.url).json()

    def put(self, state):
        return self.client.put(self.url, json.dumps(state), content_type="application/json")

    def add_lead(self, state):
        state["data"]["leads"][self.lead_id] = {
            "id": self.lead_id, "name": "Corner Store", "category": "Retail",
            "area": "Mumbai", "owner": "", "phone": "", "lat": 19, "lng": 72,
            "openedAt": None,
        }

    def visit(self, follow_up=None):
        return {"id": str(uuid.uuid4()), "leadId": self.lead_id, "rating": "Hot",
                "remarks": "Follow up on Tuesday", "followUpDate": follow_up, "nextAction": "Call back"}

    def test_requires_login_and_csrf(self):
        self.assertEqual(Client().get(self.url).status_code, 401)
        self.assertEqual(Client().get("/").status_code, 302)
        checked = Client(enforce_csrf_checks=True)
        checked.force_login(self.user)
        self.assertEqual(checked.put(self.url, "{}", content_type="application/json").status_code, 403)
        self.assertContains(checked.get("/"), "csrf-token")

    def test_create_edit_and_isolation(self):
        state = self.state()
        self.add_lead(state)
        created = self.put(state)
        self.assertEqual(created.status_code, 200)
        state = created.json()
        state["data"]["leads"][self.lead_id]["name"] = "Edited"
        self.assertEqual(self.put(state).status_code, 200)
        self.assertEqual(Lead.objects.get().name, "Edited")
        other = Client()
        other.force_login(get_user_model().objects.create_user("other"))
        self.assertEqual(other.get(self.url).json()["data"]["leads"], {})
        stolen = {"revision": 0, "data": state["data"]}
        self.assertEqual(other.put(self.url, json.dumps(stolen), content_type="application/json").status_code, 409)
        self.assertEqual(Lead.objects.get().user, self.user)

    def test_duplicate_plan_and_stale_revision(self):
        state = self.state()
        self.add_lead(state)
        state["data"]["plans"][self.today] = [self.lead_id] * 2
        self.assertEqual(self.put(state).status_code, 400)
        self.assertFalse(Lead.objects.exists())
        state["data"]["plans"][self.today] = [self.lead_id]
        self.assertEqual(self.put(state).status_code, 200)
        self.assertEqual(self.put(state).status_code, 409)
        self.assertEqual(PlanStop.objects.count(), 1)

    def test_visits_validate_and_keep_completed_stops(self):
        state = self.state()
        self.add_lead(state)
        state["data"]["plans"][self.today] = [self.lead_id]
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        state["data"]["visits"] = [self.visit(yesterday)]
        self.assertEqual(self.put(state).status_code, 400)
        state["data"]["visits"] = [self.visit(), self.visit()]
        saved = self.put(state)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(Visit.objects.count(), 2)
        result = saved.json()
        result["data"]["plans"] = {}
        self.assertEqual(self.put(result).status_code, 400)
        self.assertEqual(PlanStop.objects.count(), 1)

    def test_opened_date_is_protected(self):
        state = self.state()
        self.add_lead(state)
        state["data"]["leads"][self.lead_id]["openedAt"] = self.today
        saved = self.put(state).json()
        saved["data"]["leads"][self.lead_id]["openedAt"] = "2000-01-01"
        self.assertEqual(self.put(saved).status_code, 200)
        self.assertEqual(Lead.objects.get().opened_on.isoformat(), self.today)

    def test_lesson_completion_requires_correct_answer(self):
        state = self.state()
        state["data"]["completedLessons"] = ["products"]
        self.assertEqual(self.put(state).status_code, 400)
        state["quiz"] = {"lesson": "products", "answer": "Monthly transaction needs"}
        saved = self.put(state)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["data"]["completedLessons"], ["products"])

    def test_google_link_can_save_without_copying_listing_details(self):
        state = self.state()
        self.add_lead(state)
        state["data"]["leads"][self.lead_id].update(
            name="", area="", lat=None, lng=None, googlePlaceId="ChIJExample"
        )
        response = self.put(state)
        self.assertEqual(response.status_code, 200)
        result = response.json()["data"]["leads"][self.lead_id]
        self.assertEqual(result["googlePlaceId"], "ChIJExample")
        self.assertEqual(result["name"], "")
        self.assertIsNone(result["lat"])

    def test_visit_photo_is_optional_private_and_validated(self):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        state = self.state()
        self.add_lead(state)
        visit = self.visit()
        state["data"]["visits"] = [visit]
        url = f"/api/visits/{visit['id']}/photo"
        rejected = self.client.post(self.url, {
            "payload": json.dumps(state), "photo_visit": visit["id"],
            "photo": SimpleUploadedFile("not-an-image.png", b"<html>no</html>"),
        })
        self.assertEqual(rejected.status_code, 400)
        self.assertFalse(Visit.objects.exists())

        image = BytesIO()
        Image.new("RGB", (12, 12), "green").save(image, format="PNG")
        saved = self.client.post(self.url, {
            "payload": json.dumps(state), "photo_visit": visit["id"],
            "photo": SimpleUploadedFile("business.png", image.getvalue()),
        })
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()["data"]["visits"][0]["hasPhoto"])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertIn("no-store", response["Cache-Control"])
        other = Client()
        other.force_login(get_user_model().objects.create_user("other-photo-user"))
        self.assertEqual(other.get(url).status_code, 404)
        self.assertEqual(Client().get(url).status_code, 404)
