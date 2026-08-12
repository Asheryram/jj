# Functional & Non-Functional Requirements
## JamesDataConsult — Data Bundle & Reseller Platform

Prepared by: Asher Yram Tetteh-Abotsi
Date: August 2026
Version: 1.1

---

## 0. Change log

### 1.1 — the reseller chain
Version 1.0 described a single cost price sourced from DataHub GH, with agents
free to set any resale price at or above it. That left **no room for James's own
margin**: an agent could sell at the supplier's wholesale price and the platform
would earn nothing on the sale. It also gave agents no way to sell to a customer
without personally collecting the money first.

Version 1.1 fixes both:

| Change | Requirements affected |
|---|---|
| **Four price tiers** per product instead of one, so James's margin is built into every agent's cost rather than calculated as a commission | FR-3.3, FR-3.4, FR-3.7, FR-3.8 |
| **Split at sale** — the buyer pays the platform and every participant in the chain is credited their own margin as the order completes | FR-2.8 → FR-2.11 |
| **Agent sell links**, so a customer can buy at an agent's prices without the agent handling money | FR-5.7 → FR-5.9 |
| **Guest checkout**, without which a sell link is useless | FR-4.8, FR-2.12 |
| **Guest order tracking**, because a guest has no order history to recover a voucher from | FR-4.9 |
| Agent wallets become **earnings accounts** — credited by sales, never topped up | FR-2.1, FR-2.7 |

---

## 1. Introduction

### 1.1 Purpose
This document defines the functional and non-functional requirements for **JamesDataConsult**, a web platform for selling data bundles, airtime, voice bundles, SMS bundles, MTN AFA registration, and BECE/WASSCE result checkers, with a built-in agent referral system.

### 1.2 Scope
The system covers the customer-facing storefront, agent/customer accounts and wallets, order processing through the DataHub GH API, payment processing via Paystack, and a referral system allowing agents to register other agents under them (single-level for now, with a toggle for future multi-level support).

### 1.3 Definitions
| Term | Meaning |
|---|---|
| Agent | A registered user who resells products at their own chosen price |
| Upline | The agent (or James) directly above another agent in the chain. An agent's cost price is their upline's resale price |
| Downline | Every agent beneath a given agent, at any depth |
| Chain | The path from the selling agent up through every upline to James |
| **Sell link** | A public storefront at `/s/<code>` priced at that agent's prices. Customers buy through it; the agent never handles the money |
| **Referral link** | A signup link at `/register?ref=<code>` that registers a **new agent** beneath the sharer. Distinct from a sell link |
| **Split** | The division of one sale between the supplier, James, and every agent in the chain. Recorded on the order |
| Customer wallet | A spendable balance a customer tops up, so repeat purchases need no Mobile Money prompt |
| Agent earnings | An agent's balance, credited automatically by their margin on each completed sale and withdrawable to Mobile Money. Never topped up |
| Upstream provider | DataHub GH — supplies data/airtime/SMS/voice bundles via API |
| Checker voucher | A serial number + PIN used to check BECE/WASSCE results |
| Guest | Someone who buys without an account, paying by Mobile Money at checkout |

### 1.4 The commercial model

Money flows in one direction and every party's margin is the gap between what
they pay and what they charge. Nothing is calculated as a commission.

```
DataHub GH  ──supplier cost──▶  James  ──agent price──▶  Agent  ──resale price──▶  Customer
                                  │                        │
                          keeps the difference     keeps the difference
```

With multi-level referral enabled (FR-5.5) the chain simply gets longer, and each
additional agent adds their own markup. A customer buying with no sell link pays
James's standard price and James keeps the entire spread.

---

---

## 2. Functional Requirements

### 2.1 User Accounts & Authentication

| ID | Requirement |
|---|---|
| FR-1.1 | The system shall allow a new user to register with name, phone number, email, and password. |
| FR-1.2 | The system shall allow registration via a referral link or referral code, linking the new account to the referring agent. |
| FR-1.3 | The system shall allow users to log in and log out securely. |
| FR-1.4 | The system shall allow users to reset a forgotten password via email or SMS verification. |
| FR-1.5 | The system shall support two account roles at minimum: Customer and Agent. Admin (James) is a separate elevated role. |
| FR-1.6 | The system shall allow a user to upgrade from Customer to Agent, or register directly as an Agent. |
| FR-1.7 | Each user account shall have a unique referral code and referral link generated automatically upon registration. |

### 2.2 Wallet & Payments

| ID | Requirement |
|---|---|
| FR-2.1 | Each **customer** account shall have a spendable wallet, starting at zero. Each **agent** account shall instead have an earnings account, which is credited by sales and cannot be topped up. |
| FR-2.2 | The system shall allow customers to top up their wallet via Paystack (Mobile Money and card payments). |
| FR-2.3 | The system shall deduct the applicable amount from a customer's wallet upon successful order placement. |
| FR-2.4 | The system shall record every wallet transaction (top-up, purchase, refund) and every earnings entry (sale, downline sale, reversal, withdrawal) with timestamp, amount, type and reference. |
| FR-2.5 | The system shall prevent a wallet-paid order from being placed if the wallet balance is insufficient, and shall offer Mobile Money as an alternative rather than blocking the sale. |
| FR-2.6 | The system shall allow agents to request withdrawal of their earnings balance (manual approval by admin for v1). |
| FR-2.7 | The system shall issue a refund automatically if an order fails after payment, and shall reverse every earnings credit made against that order so that nobody profits from an undelivered bundle. |
| FR-2.8 | On successful completion of an order, the system shall credit each participant in the chain with their own margin, in the same transaction that records the order as completed. |
| FR-2.9 | The system shall record the full split of every order (supplier cost plus each participant's paid, charged and margin amounts) against that order, snapshotted at purchase time. |
| FR-2.10 | The recorded split shall always balance: the price the buyer paid shall equal the supplier cost plus the sum of all participants' margins. |
| FR-2.11 | Changing any price tier shall not alter the split recorded on an order already placed. |
| FR-2.12 | Where a guest pays by Mobile Money and the order fails, the system shall hold the refund as a credit against their phone number and notify them by SMS with a link to claim it as a wallet balance or request a Mobile Money return. |

### 2.3 Product Catalog & Pricing

| ID | Requirement |
|---|---|
| FR-3.1 | The system shall display available products by category: Data Bundles, Airtime, Voice Bundles, SMS Bundles, AFA Registration, Result Checkers. |
| FR-3.2 | The system shall display products by network: MTN, Telecel, AirtelTigo (where applicable). |
| FR-3.3 | The system shall store four price tiers per product: **supplier cost** (what James pays DataHub GH or the voucher supplier), **agent price** (what James charges his agents), **standard price** (what a walk-up customer pays), and **retail cap** (the most anyone in the chain may charge). |
| FR-3.4 | Each agent shall be able to set their own resale price per product, provided it is not below **their own cost** — which is their upline's resale price, or James's agent price if they sit directly beneath him — and not above the retail cap. |
| FR-3.5 | A customer buying without a sell link shall see the standard price set by James. A customer arriving through an agent's sell link shall see that agent's prices. |
| FR-3.6 | The system shall allow James to update any of the four tiers per product, and shall refuse a set of tiers that are out of order (agent price below supplier cost, or cap below agent price). |
| FR-3.7 | The supplier cost shall never be visible to any user other than James. An agent shall see only their own cost, their own price and their own margin. |
| FR-3.8 | Where an agent has not set a price for a product, the system shall apply their default markup percentage to their own cost, clamped to the retail cap. |
| FR-3.9 | If a price change pushes an agent's cost above their existing resale price, that product shall sell at their cost until they set a new price, and the agent shall be told so on their pricing page. |

### 2.4 Ordering & Fulfillment

| ID | Requirement |
|---|---|
| FR-4.1 | The system shall allow a user to select a product, enter a recipient phone number, and confirm purchase. |
| FR-4.2 | The system shall validate the recipient phone number format and network before submitting an order. |
| FR-4.3 | The system shall submit confirmed orders to the DataHub GH API automatically. |
| FR-4.4 | The system shall update order status (Pending, Processing, Completed, Failed) based on the upstream provider's response/webhook. |
| FR-4.5 | The system shall notify the user (on-screen and/or SMS) when an order is completed or fails. |
| FR-4.6 | The system shall retry a failed order submission automatically once before marking it as failed and refunding the wallet. |
| FR-4.7 | For result checkers, the system shall deliver the voucher serial number and PIN to the user on-screen and via SMS immediately upon successful payment. |
| FR-4.8 | The system shall allow a purchase to be completed **without an account**, paying by Mobile Money at checkout. Without this an agent's sell link cannot function, since a customer arriving on it would be forced to register and pre-fund a wallet. |
| FR-4.9 | The system shall provide a public order lookup by reference plus phone number, so a guest can check an order's status and re-display a checker voucher whose SMS did not arrive. |
| FR-4.10 | The system shall record, against each order, which sell link it was placed through (if any) and whether it was paid from a wallet or by Mobile Money. |

### 2.5 Agent & Referral System

| ID | Requirement |
|---|---|
| FR-5.1 | The system shall link a new agent's account to the referring agent's account via the referral code/link used at signup. |
| FR-5.2 | An agent shall be able to view a list of agents registered under them. |
| FR-5.3 | An agent's profit shall be (their resale price − their own cost) per order, requiring no separate commission calculation. Because their cost is their upline's price, every upline is paid automatically on every sale beneath them. |
| FR-5.4 | The system shall support only single-level referral (agent → sub-agent, no deeper) by default. |
| FR-5.5 | The system shall include an admin-configurable toggle to enable multi-level referral (sub-agents recruiting their own sub-agents) in the future, without requiring a system rebuild. Every account shall store its upline from registration onwards regardless of the toggle's state, so enabling it requires no migration or backfill. |
| FR-5.6 | When multi-level referral is toggled on, the system shall track and display the full referral chain for each agent, and each agent shall earn their margin on sales at any depth beneath them. |
| FR-5.7 | Each agent shall have a **sell link** — a public storefront priced at their own prices — which is separate from their referral link. An order placed through it shall be attributed to that agent and split up their chain. |
| FR-5.8 | An agent shall be able to see, per order, how the money divided between the supplier, James and each agent in the chain, and which of those was them. |
| FR-5.9 | The system shall enforce the retail cap (FR-3.3) so that a long referral chain cannot inflate the customer-facing price beyond what James considers competitive. |
| FR-5.10 | An agent shall be able to place an order through their own sell link, in which case their own margin is credited back to them so their net cost is their own cost price. |

### 2.6 Agent & Admin Dashboards

| ID | Requirement |
|---|---|
| FR-6.1 | Agents shall have a dashboard showing their sales, earnings balance, sell link, and the agents in their chain. |
| FR-6.2 | Agents shall be able to view and edit their own resale prices from their dashboard, with their cost floor and the retail cap shown for each product. |
| FR-6.3 | James (admin) shall have a dashboard showing all orders, all users, total turnover, his own margin, and system-wide statistics. |
| FR-6.4 | James shall be able to update all four price tiers, approve/reject withdrawal requests, and toggle the multi-level referral feature from the admin dashboard. |
| FR-6.5 | James shall be able to suspend or deactivate any user account without deleting their order history or ledger entries. |
| FR-6.6 | The admin dashboard shall show how turnover divided between the supplier, James and the agent network, computed from the recorded splits rather than estimated. |
| FR-6.7 | The admin dashboard shall show the total customer wallet float held, labelled as a liability rather than as revenue. |

### 2.7 Notifications

| ID | Requirement |
|---|---|
| FR-7.1 | The system shall send an SMS or on-screen notification confirming successful wallet top-up. |
| FR-7.2 | The system shall send an SMS or on-screen notification confirming order completion, including delivered product details. |
| FR-7.3 | The system shall notify James when a withdrawal request is submitted. |

### 2.8 Reporting

| ID | Requirement |
|---|---|
| FR-8.1 | The system shall generate a sales summary (daily, weekly, monthly) viewable by James. |
| FR-8.2 | Agents shall be able to view their own sales summary for a selected date range. |
| FR-8.3 | The system shall allow James to export order/transaction data (e.g. CSV) for record-keeping. |

---

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement |
|---|---|
| NFR-1.1 | The storefront shall load within 3 seconds on a standard 4G mobile connection. |
| NFR-1.2 | Order submission to the DataHub GH API shall be initiated within 2 seconds of payment confirmation. |
| NFR-1.3 | The system shall support at least 100 concurrent users without noticeable performance degradation at launch, scalable as usage grows. |

### 3.2 Security

| ID | Requirement |
|---|---|
| NFR-2.1 | All passwords shall be stored using secure hashing (never in plain text). |
| NFR-2.2 | All data in transit shall be encrypted via HTTPS/SSL. |
| NFR-2.3 | Payment processing shall be handled entirely through Paystack; the system shall never store raw card details. |
| NFR-2.4 | API keys and credentials (DataHub GH, Paystack) shall be stored as environment variables/secrets, never in source code. |
| NFR-2.5 | The system shall implement role-based access control so agents cannot view other agents' data or admin functions. An agent shall see only orders they earned from, and shall never see the supplier cost or another agent's margin. |
| NFR-2.6 | The system shall log all financial transactions in a way that cannot be edited or deleted by regular users. |
| NFR-2.7 | Resale price limits (FR-3.4) and wallet balance checks (FR-2.5) shall be enforced on the server. Client-side enforcement is for usability only and shall not be relied upon, since an agent has a direct financial incentive to bypass it. |

### 3.3 Reliability & Availability

| ID | Requirement |
|---|---|
| NFR-3.1 | The system shall target 99% uptime post-launch. |
| NFR-3.2 | The system shall handle DataHub GH API downtime gracefully, queuing or retrying orders rather than losing them. |
| NFR-3.3 | Wallet balances shall never be debited without a corresponding successful or refunded order — no silent loss of funds. This applies equally to a guest with no wallet: a failed Mobile Money order shall always result in a traceable, claimable credit (FR-2.12). |
| NFR-3.4 | The credit of every participant's margin (FR-2.8) and the recording of the order as completed shall occur atomically. A partial split — some participants credited and others not — shall not be possible. |

### 3.4 Usability

| ID | Requirement |
|---|---|
| NFR-4.1 | The interface shall be usable on mobile devices first (most customers will access via phone). |
| NFR-4.2 | The purchase flow (select product → pay → receive) shall take no more than 4 steps for a returning user. |
| NFR-4.3 | The system shall display clear error messages (e.g. "insufficient balance", "invalid number") rather than technical error codes. |

### 3.5 Scalability & Maintainability

| ID | Requirement |
|---|---|
| NFR-5.1 | The system architecture shall allow new products/networks to be added without code changes to the core ordering logic. |
| NFR-5.2 | The multi-level referral feature shall be implemented as a configurable toggle, not a hardcoded limitation, to support future scaling. |
| NFR-5.3 | The codebase shall be version-controlled (GitHub) with clear commit history to support ongoing maintenance by any future developer. |

### 3.6 Compatibility

| ID | Requirement |
|---|---|
| NFR-6.1 | The website shall function correctly on the latest versions of Chrome, Safari, and mobile browsers (Chrome Mobile, Safari iOS). |
| NFR-6.2 | The system shall support Mobile Money payments from MTN MoMo, Telecel Cash, and AirtelTigo Money via Paystack. |

### 3.7 Legal & Compliance

| ID | Requirement |
|---|---|
| NFR-7.1 | The result checker section shall include a disclaimer stating the platform is an independent reseller and not officially affiliated with WAEC. |
| NFR-7.2 | The system shall comply with Ghana's Data Protection Act by securing personal data (names, phone numbers) and not sharing it with third parties beyond what's required for order fulfillment. |
| NFR-7.3 | Terms of Service and a Privacy Policy shall be published and accepted by users at signup. |

---

## 4. Assumptions & Constraints

- DataHub GH's API is assumed to support the required product categories (data, airtime, SMS, voice, AFA) and provide delivery status via webhook or polling.
- A separate voucher supplier is assumed to be needed for BECE/WASSCE checkers unless confirmed otherwise by DataHub GH.
- Multi-level referral logic will exist in the system from launch but remain switched off (per FR-5.5) until James decides to enable it.
- Withdrawal approval is manual for v1; automated payout can be considered in a future version.
- **Agents do not pre-fund anything.** They hold no float and carry no stock, so the platform bears no credit risk from them — but it does mean every sale must route through the platform, and an agent cannot serve a walk-in customer who paid them cash outside the system except by using their own sell link.
- **Guest refunds are held as credit, not reversed.** Reversing a Mobile Money collection through Paystack is neither instant nor guaranteed, so FR-2.12 holds the money against the buyer's phone number instead. **This needs James's confirmation** — the alternative is that he returns the money by hand, which is simpler to build but leaves NFR-3.3 depending on him remembering.
- **Multi-level markup stacking inflates the retail price.** Each additional level adds its own margin, so at three or four levels deep a bundle can price itself out of the market. The retail cap (FR-3.3, FR-5.9) is the control for this, and James will need to set it deliberately per product rather than accept a default.
- Paystack transaction fees are assumed to be absorbed by James out of his own margin, not passed to the buyer or deducted from an agent's earnings. **To be confirmed.**

---

*This document should be reviewed and confirmed with James before development begins, and updated if requirements change.*
