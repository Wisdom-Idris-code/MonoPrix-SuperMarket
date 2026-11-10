# Product Image Sourcing and Media Architecture

This document records the image strategy for the Monoprix Online demonstration catalogue.

## Overview

- Local demonstration assets are generated internally for the prototype to avoid dependency on third-party stock APIs at runtime.
- Product imagery is reviewed and associated with the relevant product in the application database.
- Every product record includes source metadata, licensing notes, and an attribution trail.

## Source Policy

- Product images are matched to the correct product name and packaging category.
- Use approved internal demonstration assets or locally generated vector artwork when a licensed photo is not available.
- Do not invent official brand packaging or promotional artwork.

## Open Food Facts

The Open Food Facts API may be used as a future optional data source for product discovery. The implementation must respect its terms, custom user agent, and rate limits. All imported data must be reviewed before it enters the database. Product photos must carry attribution where required, and CC BY-SA restrictions must be respected.

## Cloudinary

Cloudinary is included as the production-ready image delivery layer for the application. In production, secure signed uploads and transforms should be used. Backend code handles image uploads; frontend code never contains API secrets.

## Local Demo Image Strategy

The demo catalogue uses generated SVG product visuals with structured metadata. This prevents runtime dependence on external stock image search APIs while still allowing a polished storefront experience.

## Product Manifest

The following files are used as part of the image workflow:

- `apps/api/src/data/demo-data.ts` for product catalogue metadata
- `apps/api/src/routes/assets.ts` for local SVG generation
- `apps/web/src` for storefront presentation

## Attribution and Ownership

The demo application is a concept project with clearly labelled sample data. Product image provenance is tracked internally and should be reviewed before any production deployment.

## Fallback Handling

When a product image is unavailable, a neutral placeholder illustration is generated instead of a random photo.
