from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from desk import views

urlpatterns = [
    path("", views.home, name="home"),
    path("admin/", admin.site.urls),
    path("accounts/register/", views.register, name="register"),
    path("accounts/", include("django.contrib.auth.urls")),
    path("api/session", views.session),
    path("api/maps-config", views.maps_config),
    path("api/workspace", views.workspace),
    path("api/beat/availability", views.beat_availability),
    path("api/leads/<uuid:lead_id>/pitch-options", views.pitch_options),
    path("api/leads/<uuid:lead_id>/pitch", views.lead_pitch),
    path("api/visits/<uuid:visit_id>/photo", views.visit_photo),
    path("maps-and-data", TemplateView.as_view(template_name="maps_and_data.html"), name="maps-data"),
]
