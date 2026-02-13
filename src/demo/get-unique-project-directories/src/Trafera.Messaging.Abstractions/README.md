---
post_title: Trafera.Messaging.Abstractions
author1: GitHub Copilot
author2:
post_slug: trafera-messaging-abstractions
microsoft_alias: copilot
featured_image: https://example.com/featured.png
categories:
  - messaging
tags:
  - dotnet
  - contracts
  - integration
ai_note: AI-assisted
summary: Core messaging contracts and base exceptions for Trafera messaging.
post_date: 2026-02-09
---

## Overview

Trafera.Messaging.Abstractions provides the minimal contracts used by internal and
external messaging components. It has no dependencies and can be referenced by
shared contract packages.

## Key Types

- IInternalCommand
- IDomainEvent
- IExternalCommand
- IIntegrationEvent
- MessagingException
