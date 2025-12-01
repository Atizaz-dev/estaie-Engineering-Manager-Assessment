# Terraform Infrastructure Refactoring

## Problem with Original main.tf

The original `main.tf` file had **all infrastructure code in a single 400-line file**, which caused several issues:

### Issues:
1. **Poor Maintainability** - Hard to find and update specific resources
2. **No Reusability** - Can't reuse components across environments
3. **Difficult Testing** - Can't test modules independently
4. **Merge Conflicts** - Multiple team members editing same file
5. **No Separation of Concerns** - Networking, database, compute all mixed together
6. **Hard to Read** - 400+ lines of code in one file

---

## Solution: Modular Terraform Structure

### New Structure

```
terraform/
├── README.md                    # Documentation
├── main.tf                      # Root module (orchestrates everything)
├── variables.tf                 # Input variables
├── outputs.tf                   # Output values
├── versions.tf                  # Terraform & provider versions
├── terraform.tfvars.example     # Example variable values
│
├── modules/                     # Reusable modules
│   ├── networking/              # VPC, subnets, firewall
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── database/                # Cloud SQL
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── cache/                   # Redis
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── messaging/               # Pub/Sub
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── compute/                 # Cloud Run
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── load-balancer/           # LB + Cloud Armor
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── secrets/                 # Secret Manager
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
└── environments/                # Environment-specific configs
    ├── dev/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── terraform.tfvars
    │   └── backend.tf
    ├── staging/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── terraform.tfvars
    │   └── backend.tf
    └── production/
        ├── main.tf
        ├── variables.tf
        ├── terraform.tfvars
        └── backend.tf
```

---

## Benefits of Modular Structure

### 1. **Separation of Concerns**
Each module handles one specific area:
- **Networking module** → VPC, subnets, firewall
- **Database module** → Cloud SQL, backups, replicas
- **Cache module** → Redis configuration
- **Compute module** → Cloud Run services
- **Load Balancer module** → LB + security policies

### 2. **Reusability**
Modules can be reused across environments:
```hcl
# Dev environment
module "database" {
  source = "../../modules/database"
  tier   = "db-custom-2-8192"  # Small
}

# Production environment
module "database" {
  source = "../../modules/database"
  tier   = "db-custom-8-32768"  # Large
}
```

### 3. **Independent Testing**
Test each module separately:
```bash
cd modules/networking
terraform init
terraform plan
terraform apply
```

### 4. **Clear Dependencies**
Dependencies are explicit:
```hcl
module "database" {
  source = "./modules/database"
  vpc_id = module.networking.vpc_id  # Clear dependency
  
  depends_on = [module.networking]
}
```

### 5. **Environment Isolation**
Each environment has its own:
- State file (in separate GCS buckets)
- Variable values
- Configuration

### 6. **Team Collaboration**
Different team members can work on different modules:
- **Network Engineer** → `modules/networking/`
- **Database Admin** → `modules/database/`
- **Platform Engineer** → `modules/compute/`

---

## Refactored main.tf

### Before (400+ lines):
```hcl
# Everything in one file
resource "google_compute_network" "vpc" { ... }
resource "google_compute_subnetwork" "subnet" { ... }
resource "google_sql_database_instance" "main" { ... }
resource "google_redis_instance" "cache" { ... }
resource "google_pubsub_topic" "booking_created" { ... }
resource "google_cloud_run_v2_service" "api_gateway" { ... }
# ... 400 more lines
```

### After (Clean & Modular):
```hcl
# Networking
module "networking" {
  source = "./modules/networking"
  # ... variables
}

# Database
module "database" {
  source = "./modules/database"
  vpc_id = module.networking.vpc_id
  # ... variables
}

# Cache
module "cache" {
  source = "./modules/cache"
  vpc_id = module.networking.vpc_id
  # ... variables
}

# Messaging
module "messaging" {
  source = "./modules/messaging"
  # ... variables
}

# Compute
module "compute" {
  source = "./modules/compute"
  vpc_name    = module.networking.vpc_name
  subnet_name = module.networking.subnet_name
  # ... variables
}

# Load Balancer
module "load_balancer" {
  source = "./modules/load-balancer"
  api_service_name = module.compute.api_service_name
  # ... variables
}
```

---

## Module Example: Networking

### modules/networking/main.tf
```hcl
# VPC Network
resource "google_compute_network" "vpc" {
  name                    = "estaie-vpc-${var.environment}"
  auto_create_subnetworks = false
}

# Subnet
resource "google_compute_subnetwork" "subnet" {
  name          = "estaie-subnet-${var.environment}"
  ip_cidr_range = var.vpc_cidr
  region        = var.region
  network       = google_compute_network.vpc.id
  
  private_ip_google_access = true
}

# Firewall rules, NAT, etc.
```

### modules/networking/variables.tf
```hcl
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
}
```

### modules/networking/outputs.tf
```hcl
output "vpc_id" {
  description = "VPC network ID"
  value       = google_compute_network.vpc.id
}

output "vpc_name" {
  description = "VPC network name"
  value       = google_compute_network.vpc.name
}

output "subnet_name" {
  description = "Subnet name"
  value       = google_compute_subnetwork.subnet.name
}
```

---

## Environment-Specific Configuration

### Production (environments/production/terraform.tfvars)
```hcl
project_id  = "estaie-production"
environment = "production"

# High-performance configuration
db_tier              = "db-custom-8-32768"  # 8 vCPU, 32GB
db_high_availability = true                  # HA enabled
redis_tier          = "STANDARD_HA"          # HA enabled
redis_memory_size_gb = 16                    # 16GB
api_min_instances   = 10                     # Always warm
api_max_instances   = 1000                   # Peak capacity
```

### Development (environments/dev/terraform.tfvars)
```hcl
project_id  = "estaie-dev"
environment = "dev"

# Cost-optimized configuration
db_tier              = "db-custom-2-8192"   # 2 vCPU, 8GB
db_high_availability = false                 # No HA
redis_tier          = "BASIC"                # Basic tier
redis_memory_size_gb = 4                     # 4GB
api_min_instances   = 2                      # Minimal
api_max_instances   = 10                     # Limited
```

---

## Usage

### Initialize (First Time)
```bash
cd environments/production
terraform init
```

### Plan Changes
```bash
terraform plan
```

### Apply Changes
```bash
terraform apply
```

### Destroy (Cleanup)
```bash
terraform destroy
```

---

## Best Practices Implemented

### 1. **DRY (Don't Repeat Yourself)**
- Modules are reusable across environments
- No code duplication

### 2. **Single Responsibility**
- Each module has one clear purpose
- Easy to understand and maintain

### 3. **Explicit Dependencies**
- `depends_on` makes dependencies clear
- Terraform can parallelize independent resources

### 4. **Variable Validation**
```hcl
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Must be dev, staging, or production"
  }
}
```

### 5. **Sensitive Outputs**
```hcl
output "database_password" {
  value     = random_password.db_password.result
  sensitive = true  # Won't show in logs
}
```

### 6. **Resource Naming Convention**
```
{project}-{resource}-{environment}
estaie-vpc-production
estaie-db-staging
estaie-redis-dev
```

### 7. **Tagging/Labeling**
```hcl
labels = {
  environment = "production"
  managed_by  = "terraform"
  team        = "platform"
}
```

---

## Migration Path

### From Monolithic to Modular

1. **Create module structure**
   ```bash
   mkdir -p modules/{networking,database,cache,messaging,compute,load-balancer,secrets}
   ```

2. **Extract resources into modules**
   - Move VPC resources → `modules/networking/`
   - Move Cloud SQL → `modules/database/`
   - etc.

3. **Update main.tf to use modules**
   ```hcl
   module "networking" {
     source = "./modules/networking"
     # ...
   }
   ```

4. **Test each module independently**
   ```bash
   cd modules/networking
   terraform init
   terraform plan
   ```

5. **Import existing resources** (if already deployed)
   ```bash
   terraform import module.networking.google_compute_network.vpc projects/PROJECT_ID/global/networks/VPC_NAME
   ```

---

## Comparison

| Aspect | Monolithic (Before) | Modular (After) |
|--------|-------------------|-----------------|
| **Lines in main.tf** | 400+ | ~50 |
| **Reusability** | None | High |
| **Testability** | Difficult | Easy |
| **Maintainability** | Poor | Excellent |
| **Team Collaboration** | Conflicts | Smooth |
| **Environment Separation** | None | Complete |
| **Code Organization** | Messy | Clean |

---

## Next Steps

1. **Complete remaining modules** (database, cache, messaging, compute, load-balancer, secrets)
2. **Add module documentation** (README.md in each module)
3. **Create dev and staging environments**
4. **Setup CI/CD for Terraform** (GitHub Actions)
5. **Implement Terraform Cloud/Enterprise** (for team collaboration)

---

## Conclusion

The refactored Terraform structure follows industry best practices:
- ✅ **Modular** - Reusable components
- ✅ **Maintainable** - Easy to update
- ✅ **Testable** - Independent testing
- ✅ **Scalable** - Supports multiple environments
- ✅ **Collaborative** - Team-friendly

This structure will scale with your team and infrastructure needs.

---

**Status:** ✅ Networking module complete (example)  
**TODO:** Complete remaining 6 modules  
**Estimated Time:** 4-6 hours for all modules

