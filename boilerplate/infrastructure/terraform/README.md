# estaie Infrastructure - Terraform

This directory contains the Infrastructure as Code (IaC) for estaie's platform.

## Structure

```
terraform/
├── README.md                 # This file
├── main.tf                   # Root module - orchestrates everything
├── variables.tf              # Input variables
├── outputs.tf                # Output values
├── terraform.tfvars.example  # Example variable values
├── versions.tf               # Terraform and provider versions
│
├── modules/
│   ├── networking/           # VPC, subnets, firewall rules
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── database/             # Cloud SQL (PostgreSQL)
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── cache/                # Redis (Memorystore)
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── messaging/            # Pub/Sub topics and subscriptions
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── compute/              # Cloud Run services
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── load-balancer/        # Global Load Balancer + Cloud Armor
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── secrets/              # Secret Manager
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
└── environments/
    ├── dev/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf
    ├── staging/
    │   ├── main.tf
    │   ├── terraform.tfvars
    │   └── backend.tf
    └── production/
        ├── main.tf
        ├── terraform.tfvars
        └── backend.tf
```

## Usage

### Initialize Terraform

```bash
cd environments/dev
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

### Destroy Infrastructure

```bash
terraform destroy
```

## Modules

### Networking Module
Creates VPC, subnets, and firewall rules.

### Database Module
Provisions Cloud SQL PostgreSQL instance with read replicas.

### Cache Module
Sets up Redis (Memorystore) for distributed locks and caching.

### Messaging Module
Creates Pub/Sub topics and subscriptions for event-driven architecture.

### Compute Module
Deploys Cloud Run services with auto-scaling.

### Load Balancer Module
Configures Global Load Balancer with Cloud Armor security policies.

### Secrets Module
Manages secrets in Secret Manager.

## Best Practices

1. **Modular Design:** Each module is self-contained and reusable
2. **Environment Separation:** Dev, staging, and production are isolated
3. **State Management:** Remote state in GCS with locking
4. **Variable Validation:** Input validation for safety
5. **Output Values:** Clear outputs for downstream consumption
6. **Documentation:** Each module has its own README

## Security

- Secrets are stored in Secret Manager
- IAM follows least privilege principle
- Network isolation with VPC
- Encryption at rest and in transit

