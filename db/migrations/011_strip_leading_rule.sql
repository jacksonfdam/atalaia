-- Explanations that open with a horizontal rule.
--
-- Asked for a guide in numbered sections, some models draw a `---` above the
-- first heading. It renders as a stray line in the console and as three literal
-- dashes in every channel that does not render markdown.
--
-- `cleanAnswer` removes it from everything written from now on; this is the one
-- pass over what was written before it existed. The rule is expressed twice —
-- once here in SQL, once in JavaScript — which would be a drift risk if this
-- ever ran again. It runs once, so it cannot drift; the JavaScript is the copy
-- that stays true.
--
-- Only a rule alone on the first line, and only when text follows it. A `---`
-- further down is a setext heading underline, and removing one of those demotes
-- the heading above it to a paragraph.
UPDATE vulnerabilities
SET client_explanation = regexp_replace(
        client_explanation,
        '^[[:space:]]*( {0,3}((-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})[ \t]*\r?\n[[:space:]]*)',
        ''
    )
WHERE client_explanation ~
      '^[[:space:]]*( {0,3}((-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})[ \t]*\r?\n[[:space:]]*)[[:space:]]*[^[:space:]]';
