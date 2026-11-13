# **Full-Stack Engineer Code Challenge** 

**Use Case: E-Ticketing & Payment Simulation Platform** 

## **1. Business Context** 

We are a **financial technology startup** . 

You are asked to build a **simple e-ticketing system** that simulates **real-world payments, ledger recording, and microservices architecture** . 

The system must be **deployable, explainable, and production-minded** . 

## **2. Functional Requirements** 

### **E-Ticketing (Frontend)** 

- Single-page web application (React) 

- User can: 

- Select **3 ticket types** : 

#### **Ticket Price (AED) Quota** 

|Gold|100|100|
|---|---|---|
|Premium|200|100|
|VIP|500|100|



- With total amount calculated 

- Bring the process to a checkout-page thru preferably API 

### **Checkout & Payment (Simulation)** 

- Checkout page must offer **2 payment methods** : 

   - Credit Card (Any valid CC number will be simulated as success) 

   - QR Scan (UPI/QRIS) (8 seconds delay to be triggered success) 

- Payment result: 

- Always **success** 

- Generate: 

   - Transaction ID 

   - Payment reference 

   - Timestamp 

### **Ledger & Transaction Recording** 

- Every successful payment must: 

   - Create **Transaction Record** 

   - Create **Ledger Entries** (double-entry style preferred) 

Example: 

Debit  : Cash / Payment Gateway Credit : Ticket Sales Revenue 

### **Backoffice (Optional but Valued)** 

- Simple authentication 

- View: 

   - Transactions 

   - Ledger entries 

   - Ticket availability 

## **3. Technical Expectations** 

### **Architecture** 

- **Microservices-based design** 

- Minimum suggested services: 

   - Ticket Service Backend (C# .NET) 

   - Payment Service (Node.js or Golang) 

- Ledger/Accounting Service (Python or similiar) 

- ● API communication via REST (or gRPC optional) 

### **Backend** 

- **C# (.NET)** mandatory for at least one core service 

- **Database** : 

   - MySQL or PostgreSQL 

   - Proper schema design 

   - Indexing & constraints 

- Secure API practices: 

   - API-Key or pair of ClientID/ClientSecret 

   - Input validation 

   - Idempotency for payment 

   - No secrets or sensitive env configuration committed 

### **Frontend** 

- ReactJS based (Single Page Application) 

- Clean UX, Simple CSS or no UI css frameworks required ● API-driven (Swagger preferrable, no mock data) 

### **Database Design (Important)** 

Must demonstrate: 

- Separation of: 

   - Tickets 

   - Orders / Transactions ○ Ledger entries 

- Proper relational integrity 

- Clear financial audit trail 

### **Payment Modularity** 

Design payment logic so that: 

- Payment methods are **pluggable** 

- Easy to add: 

   - Wallet 

   - Bank Transfer 

   - Crypto (future) 

Example: 

PaymentService ├── VisaMasterCardHandler ├── QRPaymentHandler └── PaymentInterface 

## **4. CI/CD & Deployment** 

### **Deployment** 

- Application must be deployed **online** ● Allowed: ○ Free AWS EC2 ○ Free tier cloud ○ Kubernetes (preferred K0s, Minikube, K3s) 

- ● Domain: ○ Free domains allowed (e.g. noip.com) 

- **CI/CD (Basic)** ● Any of: ○ GitHub Actions or GitLab CI 

- ● Minimum: ○ Lint ○ Build ○ Test ○ Dockerized image build 

### 🔁 **CI/CD (Basic)** 

### **Optional (Bonus)** 

- SonarQube integration 

- Code coverage reports ● Unit tests for: ○ Payment logic ○ Ledger posting 

## **5. Documentation (Mandatory)** 

### **README must include:** 

- Architecture diagram 

- Service responsibilities 

- How to run locally 

- How to deploy 

- Environment variables 

- API examples 

- Assumptions & trade-offs 

AI tools are allowed, but **deep understanding and explanation** will be scored significantly higher. 

## **6. Candidate Expectations** 

Candidate **must be able to** : 

- Able to **demonstrate** working demo site 

- Explain **every service** 

- Explain **database schema** 

- Explain **ledger flow** 

- Explain **why decisions were made** 

- Demo the live system 

## **7. Time Expectation** 

- ⏱ Suggested effort: **3–5 days** 

