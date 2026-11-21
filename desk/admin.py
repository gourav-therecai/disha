from django.contrib import admin
from .models import Lead, LessonCompletion, PitchProduct, PlanStop, Visit

admin.site.register([Lead, LessonCompletion, PlanStop, Visit])



@admin.register(PitchProduct)
class PitchProductAdmin(admin.ModelAdmin):
    list_display = ("name", "active", "position")
    list_editable = ("active", "position")
    search_fields = ("name", "description")
