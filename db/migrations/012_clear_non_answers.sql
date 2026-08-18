-- Explanations that are not explanations.
--
-- One row here held three characters: ```. The model opened a code fence and
-- said nothing after it. Every caller checked the answer for being empty, and a
-- three-character string is not empty, so it was stored and then shown as that
-- CVE's explanation in the console and in every channel.
--
-- `isAnswer` now catches that shape before it is written, on the same path as
-- an empty response — which already had the better error message. This is the
-- one pass over what was written before it existed.
--
-- Cleared rather than repaired: there is nothing in these to repair. Null is
-- also what the rest of the system already understands — the channels fall back
-- to the advisory's own words, and the console's batch action offers to write
-- the missing text.
--
-- The condition is deliberately blunt: not one letter and not one digit in the
-- whole column. Anything with a word in it is left alone, however scruffy,
-- because deciding that a model's prose is not good enough is not a migration's
-- job.
UPDATE vulnerabilities
SET client_explanation = NULL
WHERE client_explanation IS NOT NULL
  AND client_explanation !~ '[[:alnum:]]';
