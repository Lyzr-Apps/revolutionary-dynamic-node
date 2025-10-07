function parseLLMJson(response, options = {}) {
    const {
        attemptFix = true,
        maxBlocks = 5,
        preferFirst = true,  // Prefer first valid JSON found
        allowPartial = false // Allow partial/truncated JSON
    } = options;

    // Validate input
    if (!response || typeof response !== 'string') {
        return {
            success: false,
            error: 'Invalid input: response must be a non-empty string',
            data: null,
            rawJson: null
        };
    }

    // Cache for performance
    const jsonCache = new Map();

    // Enhanced JSON fixing function
    const fixCommonJsonIssues = (jsonStr) => {
        // Check cache first
        if (jsonCache.has(jsonStr)) {
            return jsonCache.get(jsonStr);
        }

        let fixed = jsonStr;

        // Remove BOM if present
        fixed = fixed.replace(/^\uFEFF/, '');

        // Remove all types of comments more aggressively
        fixed = fixed.replace(/\/\/.*$/gm, '');
        fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
        fixed = fixed.replace(/^\s*#.*$/gm, ''); // Python-style comments

        // Handle escaped characters that might break parsing
        fixed = fixed.replace(/\\'/g, "'");
        fixed = fixed.replace(/\\"/g, '"');

        // Fix truncated strings (common in LLM outputs)
        if (allowPartial) {
            // Close unclosed strings
            const quoteCount = (fixed.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) {
                fixed += '"';
            }
        }

        // Remove trailing commas more comprehensively
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        fixed = fixed.replace(/,\s*$/g, '');

        // Fix unquoted keys (including those with hyphens and dots)
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][\w\-\.]*)\s*:/g, '$1"$2":');

        // Convert single quotes to double quotes more carefully
        // Handle nested quotes
        fixed = fixed.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

        // Fix boolean and null values that might be incorrectly formatted
        fixed = fixed.replace(/:\s*True\b/gi, ': true');
        fixed = fixed.replace(/:\s*False\b/gi, ': false');
        fixed = fixed.replace(/:\s*None\b/gi, ': null');
        fixed = fixed.replace(/:\s*undefined\b/gi, ': null');

        // Handle Python-style lists/dicts
        fixed = fixed.replace(/\bTrue\b/g, 'true');
        fixed = fixed.replace(/\bFalse\b/g, 'false');
        fixed = fixed.replace(/\bNone\b/g, 'null');

        // Fix improperly escaped quotes inside strings
        fixed = fixed.replace(/"([^"]*)\\"([^"]*)"/, '"$1\\"$2"');

        // Handle ellipsis in truncated content
        fixed = fixed.replace(/\.\.\./g, '');
        fixed = fixed.replace(/…/g, '');

        // Cache the result
        jsonCache.set(jsonStr, fixed);
        return fixed;
    };

    // Enhanced JSON extraction
    const extractJson = (text) => {
        const results = [];

        // Priority 1: Look for code blocks with json marker
        const jsonBlockPattern = /```(?:json|JSON)\s*\n?([\s\S]*?)\n?```/g;
        let match;
        while ((match = jsonBlockPattern.exec(text)) !== null) {
            if (results.length >= maxBlocks) break;
            const content = match[1]?.trim();
            if (content) results.push({ content, priority: 1 });
        }

        // Priority 2: Look for any code blocks
        const codeBlockPattern = /```\s*\n?([\s\S]*?)\n?```/g;
        while ((match = codeBlockPattern.exec(text)) !== null) {
            if (results.length >= maxBlocks) break;
            const content = match[1]?.trim();
            if (content && (content.startsWith('{') || content.startsWith('['))) {
                results.push({ content, priority: 2 });
            }
        }

        // Priority 3: Look for inline code blocks
        const inlinePattern = /`([^`]+)`/g;
        while ((match = inlinePattern.exec(text)) !== null) {
            if (results.length >= maxBlocks) break;
            const content = match[1]?.trim();
            if (content && (content.startsWith('{') || content.startsWith('['))) {
                results.push({ content, priority: 3 });
            }
        }

        // Priority 4: Extract JSON-like structures directly
        // Improved regex to handle nested structures better
        const jsonPatterns = [
            /(\{(?:[^{}]|(?:\{[^{}]*\}))*\})/g,  // Nested objects
            /(\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\])/g, // Nested arrays
        ];

        for (const pattern of jsonPatterns) {
            pattern.lastIndex = 0;
            while ((match = pattern.exec(text)) !== null) {
                if (results.length >= maxBlocks) break;
                const content = match[1]?.trim();
                if (content && content.length > 10) { // Minimum length check
                    results.push({ content, priority: 4 });
                }
            }
        }

        // Sort by priority if preferFirst is true
        if (preferFirst) {
            results.sort((a, b) => a.priority - b.priority);
        }

        return results.map(r => r.content);
    };

    // Smart JSON boundary detection
    const findJsonBoundaries = (text) => {
        let start = -1;
        let end = -1;
        let depth = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{' || char === '[') {
                    if (start === -1) start = i;
                    depth++;
                } else if (char === '}' || char === ']') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        end = i + 1;
                        break;
                    }
                }
            }
        }

        if (start !== -1 && end !== -1) {
            return text.substring(start, end);
        }

        // If we couldn't find complete boundaries but allowPartial is true
        if (allowPartial && start !== -1) {
            return text.substring(start) + (depth > 0 ? '}' : '');
        }

        return null;
    };

    // Enhanced parsing attempt
    const tryParseJson = (jsonStr) => {
        if (!jsonStr || jsonStr.trim().length === 0) {
            return { success: false, data: null, error: 'Empty JSON string' };
        }

        let cleanJson = jsonStr.trim();

        // Try direct parse first (fastest)
        try {
            const parsed = JSON.parse(cleanJson);
            return { success: true, data: parsed, error: null };
        } catch (firstError) {
            // Continue to fixing attempts
        }

        if (attemptFix) {
            // Try boundary detection
            const boundedJson = findJsonBoundaries(cleanJson);
            if (boundedJson) {
                try {
                    const parsed = JSON.parse(boundedJson);
                    return { success: true, data: parsed, error: null };
                } catch (e) {
                    // Continue to other fixes
                }
            }

            // Apply comprehensive fixes
            cleanJson = fixCommonJsonIssues(cleanJson);

            try {
                const parsed = JSON.parse(cleanJson);
                return { success: true, data: parsed, error: null };
            } catch (secondError) {
                // Last resort: try to extract just the JSON part
                const extracted = findJsonBoundaries(cleanJson);
                if (extracted) {
                    try {
                        const parsed = JSON.parse(extracted);
                        return { success: true, data: parsed, error: null };
                    } catch (e) {
                        // Final failure
                    }
                }
            }
        }

        return {
            success: false,
            data: null,
            error: 'Failed to parse JSON after all attempts'
        };
    };

    // Main parsing logic
    const candidates = extractJson(response);

    // Helper to unwrap response field if present
    const unwrapResponse = (data, maxAttempts = 2) => {
        let current = data;
        let attempts = 0;

        while (attempts < maxAttempts && current && typeof current === 'object') {
            // Check if there's a "response" field
            if ('response' in current && current.response) {
                // If response is a string, try to parse it
                if (typeof current.response === 'string') {
                    const parsed = tryParseJson(current.response);
                    if (parsed.success) {
                        current = parsed.data;
                        attempts++;
                    } else {
                        // Can't parse the response string, return current
                        break;
                    }
                }
                // If response is already an object, unwrap it
                else if (typeof current.response === 'object') {
                    current = current.response;
                    attempts++;
                }
                else {
                    // Response field exists but isn't useful, break
                    break;
                }
            } else {
                // No response field, we're done
                break;
            }
        }

        return current;
    };

    // Try each candidate
    for (const jsonStr of candidates) {
        const result = tryParseJson(jsonStr);
        if (result.success) {
            return unwrapResponse(result.data);
        }
    }

    // If no candidates from extraction, try the whole response
    const directResult = tryParseJson(response);
    if (directResult.success) {
        return unwrapResponse(directResult.data);
    }

    // Final fallback: aggressive extraction
    if (attemptFix) {
        const aggressiveJson = findJsonBoundaries(response);
        if (aggressiveJson) {
            const result = tryParseJson(aggressiveJson);
            if (result.success) {
                return unwrapResponse(result.data);
            }
        }
    }

    return {
        success: false,
        data: null,
        error: 'No valid JSON found in the response',
        rawJson: null
    };
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = parseLLMJson;
} else if (typeof define === 'function' && define.amd) {
    define([], function () { return parseLLMJson; });
} else {
    if (typeof globalThis !== 'undefined') {
        globalThis.parseLLMJson = parseLLMJson;
    } else if (typeof window !== 'undefined') {
        window.parseLLMJson = parseLLMJson;
    }
}

export default parseLLMJson;