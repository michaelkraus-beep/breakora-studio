from main import app
for route in app.routes:
    if hasattr(route, "path"):
        methods = getattr(route, "methods", "WS")
        print(f"{route.path} {methods}")
