import json
from hashlib import sha256
import re
from datetime import date, timedelta
from uuid import UUID

from django.conf import settings
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Exists, OuterRef, Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .models import ACTIONS, CATEGORIES, LESSONS, RATINGS, Lead, LeadPitch, LessonCompletion, PitchProduct, PlanStop, Visit, VisitPhoto, WorkspaceRevision

from .photos import normalize_visit_photo
from .pitches import RECIPIENTS, PitchUnavailable, generate_pitch


@login_required
@never_cache
def home(request):
    return render(request, "workspace.html")


@require_http_methods(["GET", "POST"])
def register(request):
    if request.user.is_authenticated:
        return redirect("home")
    form = UserCreationForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        login(request, form.save())
        return redirect("home")
    return render(request, "registration/register.html", {"form": form})


def error(message, status):
    return JsonResponse({"error": message}, status=status)


@never_cache
def session(request):
    if not request.user.is_authenticated:
        return error("Sign in to Disha.", 401)
    return JsonResponse({"name": request.user.get_full_name() or request.user.get_username()})


@never_cache
def maps_config(request):
    if not request.user.is_authenticated:
        return error("Sign in to Disha.", 401)
    return JsonResponse({"key": settings.GOOGLE_MAPS_BROWSER_KEY, "mapId": settings.GOOGLE_MAPS_MAP_ID})


def export_lead(lead):
    result = {
        "id": str(lead.pk), "name": lead.name, "category": lead.category,
        "area": lead.address, "owner": lead.contact, "phone": lead.phone,
        "lat": lead.latitude, "lng": lead.longitude, "openedAt": lead.opened_on,
    }
    if lead.google_place_id:
        result["googlePlaceId"] = lead.google_place_id
    return result


def export_workspace(user):
    leads = {str(lead.pk): export_lead(lead) for lead in Lead.objects.filter(user=user)}
    plans = {}
    for stop in PlanStop.objects.filter(user=user, lead__user=user):
        plans.setdefault(stop.plan_date.isoformat(), []).append(str(stop.lead_id))
    visits = [{
        "id": str(visit.pk), "leadId": str(visit.lead_id), "rating": visit.rating,
        "remarks": visit.remarks, "date": visit.visit_date, "createdAt": visit.created_at,
        "followUpDate": visit.follow_up_date, "nextAction": visit.next_action or None,
        "hasPhoto": visit.has_photo,
    } for visit in Visit.objects.filter(lead__user=user).annotate(has_photo=Exists(VisitPhoto.objects.filter(visit_id=OuterRef("pk"))))]
    lessons = list(LessonCompletion.objects.filter(user=user).values_list("lesson", flat=True))
    return {"version": 1, "leads": leads, "plans": plans, "visits": visits, "completedLessons": lessons}


LESSON_ANSWERS = {
    "products": "Monthly transaction needs",
    "pitch": "Ask for time and one relevant question",
    "playbooks": "After the visit",
    "practice": "Ask what could be easier",
}


def parse_day(value):
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("Use a calendar date in YYYY-MM-DD format.")
    return parsed


def valid_uuid(value):
    if str(UUID(value)) != value:
        raise ValueError("Invalid record identifier.")
    return value


def field(value, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError("Check the required fields and character limits.")
    return value.strip()


def coordinate(value, limit):
    if value is not None and (type(value) not in (int, float) or not -limit <= value <= limit):
        raise ValueError("Coordinates are outside the supported range.")
    return value


def save_leads(user, values, today):
    existing = {str(lead.pk): lead for lead in Lead.objects.filter(user=user)}
    if set(existing) - values.keys():
        raise ValueError("The workspace is missing saved leads.")
    for identifier, item in values.items():
        valid_uuid(identifier)
        if item["id"] != identifier:
            raise ValueError("Invalid lead identifier.")
        latitude, longitude = coordinate(item["lat"], 90), coordinate(item["lng"], 180)
        if (latitude is None) != (longitude is None):
            raise ValueError("Enter both coordinates or leave both blank.")
        phone = field(item["phone"], 24)
        google_id = field(item.get("googlePlaceId", ""), 1024)
        if not re.fullmatch(r"[+0-9 ()-]*", phone) or not re.fullmatch(r"[A-Za-z0-9_-]*", google_id):
            raise ValueError("Check the phone number or linked Google listing.")
        if item["category"] not in dict(CATEGORIES):
            raise ValueError("Select a valid category.")
        lead = existing.get(identifier)
        opened = lead.opened_on if lead else None
        if opened is None and item["openedAt"]:
            opened = today
        fields = {
            "name": field(item["name"], 100, not google_id), "category": item["category"],
            "address": field(item["area"], 140, not google_id), "contact": field(item["owner"], 80),
            "phone": phone, "latitude": latitude, "longitude": longitude,
            "google_place_id": google_id, "opened_on": opened,
        }
        if lead is None:
            Lead.objects.create(pk=identifier, user=user, **fields)
        elif any(getattr(lead, key) != value for key, value in fields.items()):
            for key, value in fields.items():
                setattr(lead, key, value)
            lead.save(update_fields=[*fields, "updated_at"])


def save_visits(user, visits, lead_ids, today):
    created = set()
    existing = set(str(pk) for pk in Visit.objects.filter(lead__user=user).values_list("pk", flat=True))
    seen = set()
    for visit in visits:
        identifier = valid_uuid(visit["id"])
        if identifier in seen or visit["leadId"] not in lead_ids:
            raise ValueError("Invalid or duplicate visit.")
        seen.add(identifier)
        if identifier in existing:
            continue
        rating, action = visit["rating"], visit["nextAction"] or ""
        if rating not in dict(RATINGS) or (action and action not in dict(ACTIONS)):
            raise ValueError("Select a valid rating and next action.")
        follow_up = parse_day(visit["followUpDate"]) if visit["followUpDate"] else None
        if follow_up and follow_up < today:
            raise ValueError("Follow-up cannot precede the visit.")
        Visit.objects.create(pk=identifier, lead_id=visit["leadId"], rating=rating,
                             remarks=field(visit["remarks"], 1500, True), visit_date=today,
                             follow_up_date=follow_up, next_action=action)
        created.add(identifier)
    if not existing.issubset(seen):
        raise ValueError("The workspace is missing visit history.")
    return created


def save_plan(user, plans, lead_ids):
    existing = {(row.plan_date, str(row.lead_id)): row for row in PlanStop.objects.filter(user=user, lead__user=user)}
    for raw_day, leads in plans.items():
        plan_day = parse_day(raw_day)
        if not isinstance(leads, list) or len(set(leads)) != len(leads) or not set(leads).issubset(lead_ids):
            raise ValueError("A plan must contain unique saved leads.")
        for position, lead_id in enumerate(leads):
            item = existing.pop((plan_day, lead_id), None)
            if item is None:
                PlanStop.objects.create(user=user, lead_id=lead_id, plan_date=plan_day, position=position)
            elif item.position != position:
                PlanStop.objects.filter(pk=item.pk).update(position=position)
    if existing:
        for (plan_day, lead_id), item in existing.items():
            if Visit.objects.filter(lead_id=lead_id, visit_date=plan_day).exists():
                raise ValueError("Completed stops stay in the plan.")
        PlanStop.objects.filter(user=user, pk__in=[item.pk for item in existing.values()]).delete()


@require_http_methods(["GET", "PUT", "POST"])
@never_cache
def workspace(request):
    user = request.user
    if not user.is_authenticated:
        return error("Sign in to Disha.", 401)
    if request.method == "GET":
        with transaction.atomic():
            revision = WorkspaceRevision.objects.filter(user=user).values_list("revision", flat=True).first() or 0
            return JsonResponse({"revision": revision, "data": export_workspace(user)})
    try:
        photo = None
        photo_visit = None
        if request.method == "POST" and request.content_type == "multipart/form-data":
            payload = json.loads(request.POST["payload"])
            photo_visit = valid_uuid(request.POST["photo_visit"])
            photo = normalize_visit_photo(request.FILES["photo"])
        elif request.method == "PUT" and request.content_type == "application/json":
            payload = json.loads(request.body)
        else:
            return error("Use JSON or the visit photo upload form.", 415)
        revision = payload["revision"]
        state = payload["data"]
        leads, plans, visits, lessons = (state[key] for key in ("leads", "plans", "visits", "completedLessons"))
        if type(revision) is not int or revision < 0 or state["version"] != 1:
            raise ValueError("Invalid workspace revision or version.")
        if not isinstance(leads, dict) or not isinstance(plans, dict) or not isinstance(visits, list) or not isinstance(lessons, list):
            raise ValueError("Invalid workspace data.")
        if any(lesson not in LESSONS for lesson in lessons):
            raise ValueError("Unknown lesson.")
        with transaction.atomic():
            current, _ = WorkspaceRevision.objects.get_or_create(user=user)
            if not WorkspaceRevision.objects.filter(pk=current.pk, revision=revision).update(revision=revision + 1):
                return error("Workspace changed in another tab. Refresh and retry.", 409)
            today = timezone.localdate()
            save_leads(user, leads, today)
            created_visits = save_visits(user, visits, leads.keys(), today)
            if photo is not None:
                if photo_visit not in created_visits:
                    raise ValueError("Attach a photo to a new visit.")
                VisitPhoto.objects.create(visit_id=photo_visit, image=photo)
            save_plan(user, plans, leads.keys())
            existing_lessons = set(LessonCompletion.objects.filter(user=user).values_list("lesson", flat=True))
            submitted = payload.get("quiz") or {}
            for lesson in set(lessons) - existing_lessons:
                if submitted.get("lesson") != lesson or submitted.get("answer") != LESSON_ANSWERS[lesson]:
                    raise ValueError("Answer the knowledge check to complete this lesson.")
                LessonCompletion.objects.create(user=user, lesson=lesson)
            return JsonResponse({"revision": revision + 1, "data": export_workspace(user)})
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError):
        return error("Check the workspace data.", 400)
    except ValueError as exc:
        return error(str(exc), 400)
    except IntegrityError:
        return error("A lead or visit already exists, or a record conflicts with this workspace.", 409)
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        return error("Workspace changed in another tab. Refresh and retry.", 409)



@require_http_methods(["GET", "HEAD"])
@never_cache
def visit_photo(request, visit_id):
    if not request.user.is_authenticated:
        raise Http404
    photo = get_object_or_404(VisitPhoto, visit_id=visit_id, visit__lead__user=request.user)
    response = HttpResponse(bytes(photo.image), content_type="image/jpeg")
    response["X-Content-Type-Options"] = "nosniff"
    return response



@require_http_methods(["GET"])
@never_cache
def pitch_options(request, lead_id):
    if not request.user.is_authenticated:
        return error("Sign in to Disha.", 401)
    lead = get_object_or_404(Lead, pk=lead_id, user=request.user)
    primary, alternate = RECIPIENTS.get(lead.category, ("Business owner", "Accounts lead"))
    products = list(PitchProduct.objects.filter(active=True).values("id", "name", "description"))
    return JsonResponse({"primary": primary, "alternate": alternate, "products": products})


@require_http_methods(["POST"])
@never_cache
def lead_pitch(request, lead_id):
    if not request.user.is_authenticated:
        return error("Sign in to Disha.", 401)
    lead = get_object_or_404(Lead, pk=lead_id, user=request.user)
    if lead.category not in dict(CATEGORIES):
        return error("Select a valid category for this lead.", 400)
    try:
        product_id = json.loads(request.body)["product_id"]
        if type(product_id) is not int:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return error("Select a product to pitch.", 400)
    product = get_object_or_404(PitchProduct, pk=product_id, active=True)
    revision = sha256(json.dumps([product.name, product.description]).encode()).hexdigest()
    key = {"lead": lead, "category": lead.category, "product": product, "product_revision": revision}
    pitch = LeadPitch.objects.filter(**key).first()
    if pitch and pitch.english and pitch.hindi:
        return JsonResponse({"english": pitch.english, "hindi": pitch.hindi})
    if not settings.OPENAI_API_KEY:
        return error("Add OPENAI_API_KEY to the server .env and restart Disha to generate pitches.", 503)

    if pitch is None:
        pitch, _ = LeadPitch.objects.get_or_create(**key)
    now = timezone.now()
    available = LeadPitch.objects.filter(pk=pitch.pk, english="", hindi="")
    claimed = available.filter(
        Q(requested_at__isnull=True) | Q(requested_at__lt=now - timedelta(seconds=45))
    ).update(requested_at=now)
    if not claimed:
        pitch.refresh_from_db()
        if pitch.english and pitch.hindi:
            return JsonResponse({"english": pitch.english, "hindi": pitch.hindi})
        return error("A pitch request is already in progress or recently failed. Try again shortly.", 429)
    try:
        result = generate_pitch(lead.category, product, RECIPIENTS[lead.category][0])
    except PitchUnavailable:
        return error("OpenAI could not generate this pitch. Check the API key and quota, then try again.", 502)
    if not available.filter(requested_at=now).update(**result):
        return error("This pitch request was superseded. Try again.", 409)
    return JsonResponse(result)
