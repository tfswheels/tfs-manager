/**
 * Decode HTML entities to their actual characters
 * Handles entities like &quot;, &lt;, &gt;, &#39;, &amp;, etc.
 *
 * @param {string} text - Text with HTML entities
 * @returns {string} - Decoded text
 */
export function decodeHTMLEntities(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Create a temporary DOM element to leverage browser's HTML entity decoding
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  const decoded = textarea.value;

  // Clean up
  textarea.remove();

  return decoded;
}

/**
 * Safely decode HTML entities, handling null/undefined values
 *
 * @param {string|null|undefined} text - Text that might contain HTML entities
 * @returns {string} - Decoded text or original value if null/undefined
 */
export function safeDecodeHTMLEntities(text) {
  if (text === null || text === undefined) {
    return text;
  }

  return decodeHTMLEntities(text);
}
