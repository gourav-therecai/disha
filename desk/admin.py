from django.contrib import admin
from .models import Lead, LessonCompletion, PlanStop, Visit

admin.site.register([Lead, LessonCompletion, PlanStop, Visit])
