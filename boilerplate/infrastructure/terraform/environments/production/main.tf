# Production Environment - Main Configuration

module "estaie_production" {
  source = "../../"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  # Networking
  vpc_cidr = var.vpc_cidr

  # Database
  db_tier              = var.db_tier
  db_disk_size         = var.db_disk_size
  db_backup_enabled    = var.db_backup_enabled
  db_high_availability = var.db_high_availability

  # Redis
  redis_tier          = var.redis_tier
  redis_memory_size_gb = var.redis_memory_size_gb

  # Cloud Run
  api_min_instances = var.api_min_instances
  api_max_instances = var.api_max_instances
  api_cpu           = var.api_cpu
  api_memory        = var.api_memory

  # Labels
  labels = var.labels
}

# Outputs
output "vpc_name" {
  value = module.estaie_production.vpc_name
}

output "database_connection_name" {
  value     = module.estaie_production.database_connection_name
  sensitive = true
}

output "redis_host" {
  value     = module.estaie_production.redis_host
  sensitive = true
}

output "api_gateway_url" {
  value = module.estaie_production.api_gateway_url
}

output "load_balancer_ip" {
  value = module.estaie_production.load_balancer_ip
}

