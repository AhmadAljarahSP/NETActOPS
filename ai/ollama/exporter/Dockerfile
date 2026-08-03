FROM python:3.11-slim
WORKDIR /app
RUN pip install requests prometheus-client --no-cache-dir
COPY exporter.py .
EXPOSE 9110 11435
CMD ["python", "exporter.py"]
