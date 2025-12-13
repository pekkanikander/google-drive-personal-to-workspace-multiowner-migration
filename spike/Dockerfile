FROM python:3.12-slim

# Create and switch to app directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the spike app
COPY . .

# Flask will listen on this port; Cloud Run sets PORT env
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Start the spike app
CMD ["python", "main.py"]
