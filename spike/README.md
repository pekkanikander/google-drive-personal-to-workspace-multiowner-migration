# Architecture Spike (Flask)

Minimal spike to prove that a personal Google account OAuth token can copy one fixed file into a Workspace Shared Drive folder.

## What this spike does
- `/admin-spike`: sanity page, shows configured IDs.
- `/user-spike`: user starts OAuth, then the app calls `files.copy` using the user token to copy `SOURCE_FILE_ID` → `DESTINATION_FOLDER_ID` with `supportsAllDrives=true`.
- Logging: stdout only; includes state, email (when available), and copy result/error.
- Tokens are kept in-memory only; restart loses them. Not production-grade.

## How to obtain the required environment variables

### How to obtain the required environment variables

#### 1. Create a Google Cloud project
Create a new GCP project via https://console.cloud.google.com/projectcreate and ensure it is selected.

#### 2. Enable Google Drive API
Visit https://console.cloud.google.com/apis/library/drive.googleapis.com and click **Enable**.

#### 3. Configure the OAuth consent screen
Open https://console.cloud.google.com/apis/credentials/consent and configure:
- App name and emails as needed
- User type: **External**

Note: At this point Google does **not** allow adding Drive scopes yet. You will add the Drive scope **after** creating the OAuth Client ID.
Save and continue.

#### 4. Add test users (mandatory for External apps with sensitive scopes)
Because the app uses an **External** OAuth consent screen and requests a **sensitive scope** (`https://www.googleapis.com/auth/drive`), Google requires listing explicit test users.
Open:
- **APIs & Services → OAuth consent screen → Audience → Test users**

Click **Add users** and add the Google accounts that will run the spike, for example:
```
example.user@gmail.com
```
Only listed test users can complete the OAuth flow; all others will receive an *access_denied* error.

#### 5. Create an OAuth 2.0 Client ID (Web application)
Go to https://console.cloud.google.com/apis/credentials and create:
- OAuth client → **Web application**
- Add redirect URI:
```
http://localhost:8080/oauth2/callback
```
Copy the **Client ID** and **Client Secret**.

Export:
```
export GOOGLE_CLIENT_ID="value-from-console"
export GOOGLE_CLIENT_SECRET="value-from-console"
```

#### 6. Add the Drive scope to the OAuth consent screen
After creating the OAuth client, return to:
- **APIs & Services → OAuth consent screen → Data Access**

Click “Add or remove scopes”.
Add the following scope manually:
```
https://www.googleapis.com/auth/drive
```
Save the updated app registration.

#### 7. Obtain SOURCE_FILE_ID
In the personal Google account:
- Open the source file in Drive.
- Copy the ID from the URL segment `/d/<ID>/view`.

Export it:
```
export SOURCE_FILE_ID="your_source_file_id"
```

#### 8. Obtain DESTINATION_FOLDER_ID
In the Workspace account:
- Open the destination folder inside the target Shared Drive.
- Copy the ID from the URL segment `/folders/<ID>`.

Export it:
```
export DESTINATION_FOLDER_ID="your_destination_folder_id"
```

#### 9. Optional variables
```
export OAUTH_REDIRECT_URI="http://localhost:8080/oauth2/callback"
export FLASK_SECRET_KEY="dev-change-me"
```

#### 10. Verify
Ensure all variables are set:
```
echo $GOOGLE_CLIENT_ID
echo $GOOGLE_CLIENT_SECRET
echo $SOURCE_FILE_ID
echo $DESTINATION_FOLDER_ID
```

## Local run (localhost:8080)
```sh
cd spike
python3 -m venv .venv # First time only
source .venv/bin/activate
pip install -r requirements.txt

export GOOGLE_CLIENT_ID="your_client_id"
export GOOGLE_CLIENT_SECRET="your_client_secret"
export SOURCE_FILE_ID="your_source_file_id"
export DESTINATION_FOLDER_ID="your_destination_folder_id"
# optional overrides
export OAUTH_REDIRECT_URI="http://localhost:8080/oauth2/callback"
export FLASK_SECRET_KEY="dev-change-me"

# Enable non-TLS localhost OAuth endpoint
export OAUTHLIB_INSECURE_TRANSPORT=1
# Don't stop on token scope warnings
export OAUTHLIB_RELAX_TOKEN_SCOPE=1
python3 main.py
```
Open `http://localhost:8080/admin-spike` and `http://localhost:8080/user-spike` in two browser windows/profiles.

## Create the OAuth client (first time)
1) In Google Cloud Console, create a project (or pick one) and enable **Google Drive API**.
2) Configure OAuth consent screen (External is fine for personal testing). Add scope `https://www.googleapis.com/auth/drive` (others are implicit).
3) Create OAuth 2.0 Client ID of type **Web application** with these redirect URIs:
   - `http://localhost:8080/oauth2/callback`
   - Later, add your Cloud Run URL: `https://<your-service>.run.app/oauth2/callback`
4) Copy the client ID/secret into the env vars above.

## Deploy to Cloud Run (sketch)
- Build container: `gcloud builds submit --tag gcr.io/<PROJECT_ID>/spike`
- Deploy: `gcloud run deploy spike --image gcr.io/<PROJECT_ID>/spike --allow-unauthenticated --region=<REGION>`
- Set env vars on the service: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOURCE_FILE_ID`, `DESTINATION_FOLDER_ID`, `OAUTH_REDIRECT_URI=https://<service-url>/oauth2/callback`, `FLASK_SECRET_KEY`.

-## Notes and caveats
- Scopes include `openid email profile` so we can log the user email; Drive scope is the main requirement.
- This spike does not use the Workspace service account yet; only user OAuth is used for Drive calls.
- No persistence, no retries, no manifest work—just the single copy operation to validate credentials and permissions.
- If you restart the app, previous state/tokens vanish; restart the flow from `/user-spike`.

### Known quirks from the spike

- Personal users must be explicitly added as **test users** on the OAuth consent screen when the app is External and uses sensitive scopes.
- For local development, both of these environment variables are required:
  - `OAUTHLIB_INSECURE_TRANSPORT=1` (allow HTTP redirect on localhost)
  - `OAUTHLIB_RELAX_TOKEN_SCOPE=1` (ignore harmless scope ordering/normalisation differences)
- The OAuth user must have write access to the destination folder in the Shared Drive; otherwise Drive reports `404 notFound` for the folder ID.
- Trailing spaces or incorrect copy-paste of IDs (file or folder) cause `File not found` errors; IDs must be copied exactly as shown in the Drive URL.
