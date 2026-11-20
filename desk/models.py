import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

CATEGORIES = [(name, name) for name in ("Pharmacy", "Restaurant", "Retail", "Apparel", "Healthcare", "Services", "Wholesale")]
RATINGS = [(name, name) for name in ("Hot", "Warm", "Cold")]
ACTIONS = [(name, name) for name in ("Call back", "Share product details", "Revisit business", "Collect documents")]
LESSONS = ("products", "pitch", "playbooks", "practice")


class WorkspaceRevision(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    revision = models.PositiveBigIntegerField(default=0)


class Lead(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    category = models.CharField(max_length=20, choices=CATEGORIES)
    address = models.CharField(max_length=140)
    contact = models.CharField(max_length=80, blank=True)
    phone = models.CharField(max_length=24, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    google_place_id = models.CharField(max_length=1024, blank=True)
    opened_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("user", "google_place_id"), condition=~Q(google_place_id=""), name="unique_user_google_place"),
            models.CheckConstraint(condition=Q(latitude__isnull=True, longitude__isnull=True) | Q(latitude__isnull=False, longitude__isnull=False, latitude__gte=-90, latitude__lte=90, longitude__gte=-180, longitude__lte=180), name="valid_lead_coordinates"),
        ]


class PlanStop(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE)
    plan_date = models.DateField()
    position = models.PositiveIntegerField()

    class Meta:
        ordering = ("plan_date", "position", "pk")
        constraints = [models.UniqueConstraint(fields=("user", "lead", "plan_date"), name="unique_user_lead_date")]

    def clean(self):
        if self.lead_id and self.user_id and self.lead.user_id != self.user_id:
            raise ValidationError("The plan and lead must belong to the same user.")


class Visit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE)
    rating = models.CharField(max_length=4, choices=RATINGS)
    remarks = models.CharField(max_length=1500)
    visit_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    follow_up_date = models.DateField(null=True, blank=True)
    next_action = models.CharField(max_length=40, choices=ACTIONS, blank=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=("lead", "visit_date"))]
        constraints = [models.CheckConstraint(condition=Q(follow_up_date__isnull=True) | Q(follow_up_date__gte=models.F("visit_date")), name="valid_follow_up_date")]


class LessonCompletion(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    lesson = models.CharField(max_length=24, choices=[(lesson, lesson) for lesson in LESSONS])
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("user", "lesson"), name="unique_user_lesson")]
