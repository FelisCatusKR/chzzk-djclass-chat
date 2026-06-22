from django.urls import path

from . import views

urlpatterns = [
    path("link/", views.link_page, name="link"),
]
