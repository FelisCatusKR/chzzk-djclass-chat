from django.urls import path

from . import views

urlpatterns = [
    # Paths preserved verbatim from the Node app so the Chzzk-registered
    # redirect_uri keeps matching (no trailing slash).
    path("api/auth/chzzk", views.chzzk_login, name="chzzk_login"),
    path("api/auth/chzzk/callback", views.chzzk_callback, name="chzzk_callback"),
    path("login/", views.login_page, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("dashboard/", views.dashboard, name="dashboard"),
]
