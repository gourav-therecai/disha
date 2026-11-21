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

    def test_pitch_options_are_private_and_list_only_active_products(self):
        from .models import PitchProduct

        state = self.state()
        self.add_lead(state)
        self.assertEqual(self.put(state).status_code, 200)
        PitchProduct.objects.create(name="Hidden product", description="Internal", active=False)
        url = f"/api/leads/{self.lead_id}/pitch-options"
        result = self.client.get(url).json()
        self.assertEqual(result["primary"], "Shop owner or proprietor")
        self.assertEqual(len(result["products"]), 3)
        self.assertNotIn("Hidden product", [product["name"] for product in result["products"]])
        self.assertEqual(Client().get(url).status_code, 401)
        other = Client()
        other.force_login(get_user_model().objects.create_user("other-pitch-user"))
        self.assertEqual(other.get(url).status_code, 404)
        self.assertEqual(other.post(f"/api/leads/{self.lead_id}/pitch").status_code, 404)

    def test_pitch_is_reused_for_same_product_and_refreshed_after_catalog_edit(self):
        from unittest.mock import patch

        from .models import PitchProduct

        state = self.state()
        self.add_lead(state)
        self.assertEqual(self.put(state).status_code, 200)
        url = f"/api/leads/{self.lead_id}/pitch"
        product, second, *_ = PitchProduct.objects.all()
        expected = {"english": "How do you receive payments?", "hindi": "आप भुगतान कैसे लेते हैं?"}

        def request(item):
            return self.client.post(url, {"product_id": item.pk}, content_type="application/json")

        self.assertEqual(self.client.post(url, {}, content_type="application/json").status_code, 400)
        with self.settings(OPENAI_API_KEY=""), patch("desk.views.generate_pitch") as generate:
            self.assertEqual(request(product).status_code, 503)
            generate.assert_not_called()
        with self.settings(OPENAI_API_KEY="test-only"), patch("desk.views.generate_pitch", return_value=expected) as generate:
            self.assertEqual(request(product).json(), expected)
            self.assertEqual(request(product).json(), expected)
            generate.assert_called_once_with("Retail", product, "Shop owner or proprietor")
            self.assertEqual(request(second).json(), expected)
            self.assertEqual(generate.call_count, 2)
            product.description = "Updated catalog guidance"
            product.save(update_fields=["description"])
            self.assertEqual(request(product).json(), expected)
            self.assertEqual(generate.call_count, 3)

    def test_openai_pitch_request_contains_selected_product_and_role(self):
        from io import BytesIO
        from unittest.mock import patch

        from .models import PitchProduct
        from .pitches import generate_pitch

        product = PitchProduct.objects.get(name="Merchant Payments")
        content = {"english": "How do you receive payments?", "hindi": "आप भुगतान कैसे लेते हैं?"}
        response = {"status": "completed", "output": [{
            "type": "message", "content": [{"type": "output_text", "text": json.dumps(content)}],
        }]}
        with self.settings(OPENAI_API_KEY="test-only"), patch(
            "desk.pitches.urlopen", return_value=BytesIO(json.dumps(response).encode())
        ) as request:
            self.assertEqual(generate_pitch("Retail", product, "Shop owner"), content)
            args, kwargs = request.call_args
            self.assertEqual(kwargs["timeout"], 12)
            body = json.loads(args[0].data)
            self.assertEqual(json.loads(body["input"]), {
                "business_category": "Retail", "suggested_role": "Shop owner",
                "product": product.name, "product_description": product.description,
            })
            self.assertFalse(body["store"])
            self.assertTrue(body["text"]["format"]["strict"])

    def test_google_business_cannot_be_allocated_to_two_reps(self):
        state = self.state()
        self.add_lead(state)
        state["data"]["leads"][self.lead_id]["googlePlaceId"] = "ChIJAssigned"
        self.assertEqual(self.put(state).status_code, 200)

        other = Client()
        other.force_login(get_user_model().objects.create_user("second-rep"))
        response = other.post("/api/beat/availability",
                              {"place_ids": ["ChIJAssigned", "ChIJFree"]}, content_type="application/json")
        self.assertEqual(response.json(), {"unavailable": ["ChIJAssigned"]})
        second = other.get(self.url).json()
        new_id = str(uuid.uuid4())
        second["data"]["leads"][new_id] = {
            **state["data"]["leads"][self.lead_id], "id": new_id,
        }
        second["data"]["plans"][self.today] = [new_id]
        attempted = other.put(self.url, json.dumps(second), content_type="application/json")
        self.assertEqual(attempted.status_code, 409)
        self.assertFalse(Lead.objects.filter(pk=new_id).exists())
        self.assertFalse(PlanStop.objects.exists())

    def test_manual_business_allocation_normalizes_name_and_address(self):
        state = self.state()
        self.add_lead(state)
        self.assertEqual(self.put(state).status_code, 200)
        other = Client()
        other.force_login(get_user_model().objects.create_user("manual-rep"))
        second = other.get(self.url).json()
        new_id = str(uuid.uuid4())
        second["data"]["leads"][new_id] = {
            **state["data"]["leads"][self.lead_id], "id": new_id,
            "name": " CORNER   STORE ", "area": " mumbai ",
        }
        self.assertEqual(other.put(self.url, json.dumps(second), content_type="application/json").status_code, 409)

    def test_territories_are_private_and_saved_by_area(self):
        route = "/api/beat/territories"
        self.assertEqual(Client().get(route).status_code, 401)
        response = self.client.post(route, {"area": "Andheri East, Mumbai", "radius": 2},
                                    content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.client.post(route, {"area": "Andheri East, Mumbai", "radius": 5},
                         content_type="application/json")
        result = self.client.get(route).json()["territories"]
        self.assertEqual([(item["area"], item["radius"]) for item in result], [("Andheri East, Mumbai", 5)])
        other = Client()
        other.force_login(get_user_model().objects.create_user("territory-rep"))
        self.assertEqual(other.get(route).json(), {"territories": []})
