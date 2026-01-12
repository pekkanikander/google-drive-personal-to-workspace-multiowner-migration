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
Create a new GCP project `google-drive-migration-spike` via https://console.cloud.google.com/projectcreate and ensure it is selected.

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
jecho $GOOGLE_CLIENT_ID
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

## Find out your Google Cloud Project ID and Service URL
### Finding your Project ID
In [Google Cloud Console](https://console.cloud.google.com/home/dashboard),
open the **project selector** at the top (the dropdown next to the Google Cloud logo).
The **Project ID** appears next to the project name in the list and typically looks like `some-words-123456-x0`.

## Deploy to Cloud Run

### Make sure you are running in the correct gcloud configuration

If needed, create and activate a new gcloud CLI configuration:

```sh
gcloud init
# Choose:
#  [2] Create a new configuration
#  Enter configuration name: google-drive-migration-spike
#  Select your Workspace admin account
#  Pick cloud project: <PROJECT_ID>
```

### Enable billing for the project

Cloud Build and Cloud Run require billing to be enabled on the project.
If billing is not attached, enabling these services will fail with:
`FAILED_PRECONDITION: Billing account for project is not found`.

To enable billing:

1. If you do not yet have a billing account, create one:
   https://console.cloud.google.com/billing

2. Open the Projects billing page:
   https://console.cloud.google.com/billing/projects

3. Select your organisation

4. Select the project you are using for the spike (e.g. `google-drive-migration-spike`).

5. At Actions, Change billing for the project.  Select the desired billing account.

After this, enabling Cloud Build / Cloud Run services will succeed:

```sh
gcloud services enable cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  containerregistry.googleapis.com \
  --project=<PROJECT_ID>
```

### Fix the IAM restrictions

Cloud Build and Cloud Run use project service accounts that, in hardened organisations, do not receive broad roles automatically. In this project, both the default Compute Engine service account and the Cloud Build service account needed explicit permissions to use the Cloud Build bucket, write images to Artifact Registry and write logs.

You can grant the required roles via the CLI (adjust PROJECT_ID as needed):

```sh
PROJECT_ID=google-drive-migration-spike   # or your actual project id
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Allow both service accounts to read/write objects in the project's buckets
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/storage.objectAdmin"

# Allow both service accounts to push images to Artifact Registry
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer"

# Optional but recommended: allow the default compute service account to write logs
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/logging.logWriter"
```

These bindings ensure that Cloud Build can upload and read the temporary source tarball from the `*_cloudbuild` bucket, push the built image to the container registry, and emit logs without further IAM errors.

### Create an artefact repository

Newer Google Cloud projects back `gcr.io` with Artifact Registry. In a fresh project, the compatibility repository named `gcr.io` may not exist yet, and automatic creation on first push can fail if the build service account lacks `artifactregistry.repositories.createOnPush` permissions.

To avoid relying on implicit creation, create the repository explicitly once:

```sh
PROJECT_ID=google-drive-migration-spike   # or your actual project id

gcloud artifacts repositories create gcr.io \
  --repository-format=DOCKER \
  --location=us \
  --description="Legacy gcr.io-compatible repo for Cloud Build spike" \
  --project="$PROJECT_ID"
```

### Build and deploy a Cloud Run Docker container:

At this point, when the artefact repository exists and the IAM bindings above are in place, use the command

```sh
gcloud builds submit spike --tag gcr.io/${PROJECT_ID}/spike
```

to create and push a Docker image into the `gcr.io` repository.



- Deploy: `gcloud run deploy spike --image gcr.io/<PROJECT_ID>/spike --allow-unauthenticated --region=<REGION>`


- Set env vars on the service: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOURCE_FILE_ID`, `DESTINATION_FOLDER_ID`, `OAUTH_REDIRECT_URI=https://<service-url>/oauth2/callback`, `FLASK_SECRET_KEY`.

## Update the OAuth client
1) In Google Cloud Console, pick the `google-drive-migration-spike` created above.
2) Update the OAuth 2.0 Client ID with the cloud redirect URIs:
   - Add your Cloud Run URL: `https://<your-service>.run.app/oauth2/callback`


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

### Secure-by-default Workspace organisations (late 2025)

In newly created Google Workspace (including Nonprofits) tenants, Google Cloud projects inherit restrictive
organisation policies such as
`iam.allowedPolicyMemberDomains`. These prevent adding `allUsers` (or often even external Gmail accounts)
as IAM members on Cloud Run services.

Consequences observed in this spike:
- `gcloud run deploy ... --allow-unauthenticated` may fail to attach an `allUsers:roles/run.invoker` binding.
- The Cloud Run service remains private: direct browser access to the `run.app` URL without an explicit identity
  token returns `Error: Forbidden`, even when the admin is logged into Google with the correct account.
- Access works when using `gcloud auth print-identity-token` (e.g. via `curl`) or `gcloud run services proxy`,
  which inject identity tokens on behalf of the caller, but these mechanisms are not viable for ordinary end-users.

The practical conclusion for this project is that Cloud Run cannot be assumed to be a simple public front-end for
personal Gmail users in fresh Workspace environments. Any production-quality deployment either needs explicit
organisation-policy changes to allow public invocation, or a different hosting surface for the user-facing web app.
This spike documents that constraint and motivates re-evaluating the deployment strategy in the main design.
