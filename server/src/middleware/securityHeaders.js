/**
 * Security Headers Middleware
 * Implements comprehensive security headers for TFS Manager API
 */

export const applyAllSecurityHeaders = (req, res, next) => {
  // Content Security Policy
  // Allow embedding in Shopify admin and necessary resources
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com",
    "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://cdn.shopify.com",
    "connect-src 'self' https://*.myshopify.com https://api.tfswheels.com",
    "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  // Allow embedding in Shopify admin iframe
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://admin.shopify.com');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable browser XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (formerly Feature Policy)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Strict Transport Security (HSTS) - only in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
};

export const applyWebhookSecurityHeaders = (req, res, next) => {
  // Minimal headers for webhook endpoints
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};
