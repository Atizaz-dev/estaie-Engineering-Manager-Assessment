# Production Environment Variables
# These mirror the root module variables

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC subnet"
  type        = string
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
}

variable "db_disk_size" {
  description = "Database disk size in GB"
  type        = number
}

variable "db_backup_enabled" {
  description = "Enable automated backups"
  type        = bool
}

variable "db_high_availability" {
  description = "Enable high availability"
  type        = bool
}

variable "redis_tier" {
  description = "Redis tier"
  type        = string
}

variable "redis_memory_size_gb" {
  description = "Redis memory size in GB"
  type        = number
}

variable "api_min_instances" {
  description = "Minimum Cloud Run instances"
  type        = number
}

variable "api_max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
}

variable "api_cpu" {
  description = "CPU allocation for Cloud Run"
  type        = string
}

variable "api_memory" {
  description = "Memory allocation for Cloud Run"
  type        = string
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
}

