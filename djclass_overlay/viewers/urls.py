from django.urls import path

from . import views

urlpatterns = [
    path("link/", views.link_page, name="link"),
    path("link/connect/", views.link_connect, name="link_connect"),
    path("link/sync/", views.link_sync, name="link_sync"),
    path("link/unlink/", views.link_unlink, name="link_unlink"),
    path("link/preferred-button/", views.link_preferred_button, name="link_preferred_button"),
]
