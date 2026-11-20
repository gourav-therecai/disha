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
    path("maps-and-data", TemplateView.as_view(template_name="maps_and_data.html"), name="maps-data"),
]
