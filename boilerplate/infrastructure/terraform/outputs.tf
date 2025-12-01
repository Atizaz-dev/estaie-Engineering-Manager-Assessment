# Networking Outputs
output "vpc_name" {
  description = "VPC network name"
  value       = module.networking.vpc_name
}

output "subnet_name" {
  description = "Subnet name"
  value       = module.networking.subnet_name
}

# Database Outputs
output "database_connection_name" {
  description = "Cloud SQL connection name"
  value       = module.database.connection_name
  sensitive   = true
}

output "database_private_ip" {
  description = "Database private IP address"
  value       = module.database.private_ip
  sensitive   = true
}

# Cache Outputs
output "redis_host" {
  description = "Redis host address"
  value       = module.cache.redis_host
  sensitive   = true
}

output "redis_port" {
  description = "Redis port"
  value       = module.cache.redis_port
}

# Compute Outputs
output "api_gateway_url" {
  description = "API Gateway Cloud Run URL"
  value       = module.compute.api_gateway_url
}

# Load Balancer Outputs
output "load_balancer_ip" {
  description = "Global Load Balancer IP address"
  value       = module.load_balancer.ip_address
}

# Messaging Outputs
output "pubsub_topics" {
  description = "Pub/Sub topic names"
  value       = module.messaging.topic_names
}

