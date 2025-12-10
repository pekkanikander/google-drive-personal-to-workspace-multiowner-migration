import os
import uuid
from typing import Dict, Optional

from flask import Flask, redirect, request
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from werkzeug.middleware.proxy_fix import ProxyFix

# Minimal in-memory stores; sufficient for the single-user spike flow.
STATE_STORE: set[str] = set()
TOKEN_STORE: Dict[str, object] = {}

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
SOURCE_FILE_ID = os.environ.get("SOURCE_FILE_ID", "1uPWOUVYL7tbsptqYIqsHm5ybTsVh8nDtnoxLVNGyALU")
DESTINATION_FOLDER_ID = os.environ.get("DESTINATION_FOLDER_ID", "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq")
REDIRECT_URI = os.environ.get("OAUTH_REDIRECT_URI", "http://localhost:8080/oauth2/callback")
BASE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]


def auth_config() -> Dict[str, object]:
    """Build client configuration for google-auth-oauthlib Flow."""
    return {
        "web": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }


def build_flow(state: Optional[str] = None) -> Flow:
    flow = Flow.from_client_config(
        auth_config(),
        scopes=BASE_SCOPES,
        redirect_uri=REDIRECT_URI,
    )
    if state:
        flow.state = state
    return flow


def log(msg: str, **kwargs) -> None:
    payload = {"event": msg, **kwargs}
    print(payload, flush=True)


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-not-secure")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # type: ignore[arg-type]


@app.route("/")
def root() -> str:
    return (
        "<p>Workspace migration spike.</p>"
        "<p>See <a href='/admin-spike'>/admin-spike</a> or <a href='/user-spike'>/user-spike</a>.</p>"
    )


@app.route("/admin-spike")
def admin_spike() -> str:
    user_url = f"{request.host_url.rstrip('/')}/user-spike"
    return f"""
    <html>
      <body>
        <h1>Admin Spike Page</h1>
        <p>App is running.</p>
        <p>User page URL: <a href="{user_url}">{user_url}</a></p>
        <h3>Configured IDs (debug only)</h3>
        <ul>
          <li>SOURCE_FILE_ID: {SOURCE_FILE_ID}</li>
          <li>DESTINATION_FOLDER_ID: {DESTINATION_FOLDER_ID}</li>
          <li>REDIRECT_URI: {REDIRECT_URI}</li>
        </ul>
      </body>
    </html>
    """


@app.route("/user-spike")
def user_spike() -> str:
    return """
    <html>
      <body>
        <h1>User Spike Page</h1>
        <p>This spike will attempt to copy one fixed file after you authorise with Google.</p>
        <form action="/oauth2/start" method="post">
          <button type="submit">Start Migration (Spike)</button>
        </form>
      </body>
    </html>
    """


@app.route("/oauth2/start", methods=["POST"])
def oauth_start():
    flow = build_flow()
    auth_url, state = flow.authorization_url(
        access_type="online",
        include_granted_scopes="true",
        prompt="select_account",
    )
    STATE_STORE.add(state)
    log("oauth_start", state=state, auth_url=auth_url)
    return redirect(auth_url)


@app.route("/oauth2/callback")
def oauth_callback():
    state = request.args.get("state")
    if not state or state not in STATE_STORE:
        return "Invalid state parameter; restart the spike flow.", 400

    flow = build_flow(state=state)
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    email = None
    if creds.id_token:
        try:
            idinfo = id_token.verify_oauth2_token(creds.id_token, Request(), CLIENT_ID)
            email = idinfo.get("email")
        except Exception as exc:  # pragma: no cover - spike logging only
            log("id_token_verify_failed", state=state, error=str(exc))

    TOKEN_STORE[state] = creds
    log("oauth_callback", state=state, email=email, scopes=list(creds.scopes or []))

    return redirect(f"/user-spike/copy-test?state={state}")


@app.route("/user-spike/copy-test")
def copy_test():
    state = request.args.get("state")
    creds = TOKEN_STORE.get(state) if state else None
    if not state or not creds:
        return "Missing token context; restart from /user-spike.", 400

    try:
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        result = (
            service.files()
            .copy(
                fileId=SOURCE_FILE_ID,
                body={"parents": [DESTINATION_FOLDER_ID]},
                supportsAllDrives=True,
            )
            .execute()
        )
        log("copy_success", state=state, new_file_id=result.get("id"), name=result.get("name"))
        return f"""
        <html>
          <body>
            <h1>Copy succeeded</h1>
            <p>New file ID: {result.get("id")}</p>
            <p>Name: {result.get("name")}</p>
          </body>
        </html>
        """
    except Exception as exc:  # pragma: no cover - spike logging only
        log("copy_failed", state=state, error=str(exc))
        return f"""
        <html>
          <body>
            <h1>Copy failed</h1>
            <p>{exc}</p>
          </body>
        </html>
        """, 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=True)
