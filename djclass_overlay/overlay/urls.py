from django.urls import path

from . import sse

urlpatterns = [
    path("widget/<str:channel_id>/stream", sse.widget_stream, name="widget_stream"),
    path("widget/<str:channel_id>/", sse.widget_page, name="widget_page"),
]
