# Backend Configuration for Production
# Stores Terraform state in Google Cloud Storage

terraform {
  backend "gcs" {
    bucket = "estaie-terraform-state-production"
    prefix = "terraform/state/production"
  }
}

