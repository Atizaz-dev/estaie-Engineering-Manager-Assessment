# estaie Infrastructure - Root Module
# This file orchestrates all infrastructure modules

# Provider configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Backend configuration (move to backend.tf in each environment)
terraform {
  backend "gcs" {
    bucket = "estaie-terraform-state"
    prefix = "terraform/state"
  }
}

# Local variables
locals {
  common_labels = merge(
    {
      environment = var.environment
      managed_by  = "terraform"
      project     = "estaie"
    },
    var.labels
  )
}

# ============================================================================
# NETWORKING MODULE
# ============================================================================
module "networking" {
  source = "./modules/networking"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  labels      = local.common_labels
}

# ============================================================================
# DATABASE MODULE
# ============================================================================
module "database" {
  source = "./modules/database"

  project_id         = var.project_id
  region             = var.region
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  tier               = var.db_tier
  disk_size          = var.db_disk_size
  backup_enabled     = var.db_backup_enabled
  high_availability  = var.db_high_availability
  labels             = local.common_labels

  depends_on = [module.networking]
}

# ============================================================================
# CACHE MODULE (Redis)
# ============================================================================
module "cache" {
  source = "./modules/cache"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  vpc_id          = module.networking.vpc_id
  tier            = var.redis_tier
  memory_size_gb  = var.redis_memory_size_gb
  labels          = local.common_labels

  depends_on = [module.networking]
}

# ============================================================================
# MESSAGING MODULE (Pub/Sub)
# ============================================================================
module "messaging" {
  source = "./modules/messaging"

  project_id  = var.project_id
  environment = var.environment
  labels      = local.common_labels
}

# ============================================================================
# COMPUTE MODULE (Cloud Run)
# ============================================================================
module "compute" {
  source = "./modules/compute"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  vpc_name        = module.networking.vpc_name
  subnet_name     = module.networking.subnet_name
  min_instances   = var.api_min_instances
  max_instances   = var.api_max_instances
  cpu             = var.api_cpu
  memory          = var.api_memory
  database_secret = module.database.password_secret_id
  redis_host      = module.cache.redis_host
  redis_port      = module.cache.redis_port
  labels          = local.common_labels

  depends_on = [module.networking, module.database, module.cache]
}

# ============================================================================
# LOAD BALANCER MODULE
# ============================================================================
module "load_balancer" {
  source = "./modules/load-balancer"

  project_id          = var.project_id
  region              = var.region
  environment         = var.environment
  api_service_name    = module.compute.api_service_name
  labels              = local.common_labels

  depends_on = [module.compute]
}

# ============================================================================
# SECRETS MODULE
# ============================================================================
module "secrets" {
  source = "./modules/secrets"

  project_id  = var.project_id
  environment = var.environment
  labels      = local.common_labels
}

