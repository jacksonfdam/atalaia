# Ticket #7: Slack Interactive Messages

**Status:** TODO
**Verified:** ❌
**Depends On:** #6 (Status Lifecycle), #5 (Logging)
**Blocks:** #11
**Priority:** HIGH

---

## Task Description

Wire up Slack interactive message buttons (Acknowledge, Resolve) and create the action handler endpoint.

### What Needs to Be Built

1. **`src/interface/slack/slackActions.js`** — Handler for Slack button clicks
2. **`src/infrastructure/notifiers/slackNotifier.js`** — Refactored Slack notifications with buttons
3. **`POST /api/v1/slack/actions`** — Endpoint to receive Slack interactions
4. **Slack signing secret validation** — Verify requests from Slack

---

## Why This Matters

- **UX:** Teams acknowledge/resolve vulns without leaving Slack
- **Audit Trail:** Know who acted and when
- **Reduced Context Switching:** No need to open separate dashboard

---

## Acceptance Criteria

- [ ] Slack button click sends to `/api/v1/slack/actions`
- [ ] Endpoint validates Slack signing secret
- [ ] Click action: `ack_vuln` calls `acknowledgeVuln()` use case
- [ ] Click action: `resolve_vuln` calls `resolveVuln()` use case
- [ ] Slack user ID captured (e.g., `slack:U12345`) as `changedBy`
- [ ] Response updates Slack message with new status
- [ ] Logging includes which user performed action
- [ ] No unvalidated Slack requests processed

---

## Implementation Steps

### Step 1: Create Slack Actions Handler

`src/interface/slack/slackActions.js`:
```javascript
import logger from '../../infrastructure/logger.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';
import crypto from 'crypto';

export function validateSlackSignature(req, signingSecret) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  // Check timestamp is within 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    return false;
  }

  // Verify signature
  const baseString = `v0:${timestamp}:${JSON.stringify(req.body)}`;
  const hash = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');

  return signature === `v0=${hash}`;
}

export async function handleSlackAction(req, res, cache) {
  const payload = JSON.parse(req.body.payload);
  const { user, actions } = payload;
  const action = actions[0];

  const cveId = action.value;
  const userId = user.id;
  const changedBy = `slack:${userId}`;

  try {
    let vuln;
    if (action.action_id === 'ack_vuln') {
      vuln = await acknowledgeVuln(cveId, changedBy, cache);
      logger.info({ cveId, userId, action: 'acknowledge' }, 'Vulnerability acknowledged via Slack');
    } else if (action.action_id === 'resolve_vuln') {
      vuln = await resolveVuln(cveId, changedBy, cache);
      logger.info({ cveId, userId, action: 'resolve' }, 'Vulnerability resolved via Slack');
    }

    res.json({ text: `✅ Vulnerability ${cveId} status updated to ${vuln.status}` });
  } catch (error) {
    logger.error({ cveId, error: error.message }, 'Slack action failed');
    res.status(400).json({ text: `❌ Error: ${error.message}` });
  }
}
```

### Step 2: Update Express Routes

Update `src/interface/http/index.js` to add:
```javascript
import { handleSlackAction, validateSlackSignature } from './slack/slackActions.js';

app.post('/api/v1/slack/actions', (req, res) => {
  if (!validateSlackSignature(req, process.env.SLACK_SIGNING_SECRET)) {
    logger.warn({ ip: req.ip }, 'Invalid Slack signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  handleSlackAction(req, res, cache);
});
```

### Step 3: Update Slack Notifier

Update `src/infrastructure/notifiers/slackNotifier.js` to include buttons in message:

```javascript
export async function notifySlack(vuln, explanation, webhookUrl) {
  const message = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: vuln.exploited ? '🚨 EXPLOITED' : '🔴 CRITICAL'
        }
      },
      // ... other blocks ...
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Acknowledge' },
            action_id: 'ack_vuln',
            value: vuln.cveId,
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔒 Resolve' },
            action_id: 'resolve_vuln',
            value: vuln.cveId,
            style: 'danger'
          }
        ]
      }
    ]
  };

  await axios.post(webhookUrl, message);
}
```

---

## Validation Conditions

### Condition 1: Slack Actions Handler Exists
```bash
test -f src/interface/slack/slackActions.js
echo "✅ Slack actions handler exists"
```

### Condition 2: Signature Validation Works
```javascript
import { validateSlackSignature } from 'src/interface/slack/slackActions.js';

const timestamp = Math.floor(Date.now() / 1000).toString();
const secret = 'test-secret';
const body = {};
const baseString = `v0:${timestamp}:${JSON.stringify(body)}`;
const hash = crypto.createHmac('sha256', secret).update(baseString).digest('hex');

const mockReq = {
  headers: {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${hash}`
  },
  body: body
};

console.assert(validateSlackSignature(mockReq, secret) === true, 'Signature validation failed');
console.log('✅ Slack signature validation works');
```

### Condition 3: Endpoint is Protected
```bash
# Send request without signature
curl -X POST http://localhost:3000/api/v1/slack/actions \
  -H "Content-Type: application/json" | grep -q "Unauthorized"
echo "✅ Slack endpoint requires signature"
```

### Condition 4: Button Click Triggers Action
```bash
# Simulate Slack button click (with valid signature)
# Should call acknowledgeVuln or resolveVuln
# Check logs for confirmation
echo "✅ Slack button clicks trigger actions"
```

### Condition 5: Slack Notifier Includes Buttons
```bash
grep -q "ack_vuln\|resolve_vuln" src/infrastructure/notifiers/slackNotifier.js
grep -q "actions\|elements" src/infrastructure/notifiers/slackNotifier.js
echo "✅ Slack messages include action buttons"
```

### Condition 6: User ID Captured
```bash
# Check logs show "slack:UXXX" format
grep -q "slack:U" src/interface/slack/slackActions.js || \
grep -q "slack:\${userId}\|slack:\${user.id}" src/interface/slack/slackActions.js
echo "✅ User IDs captured in correct format"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1)
2. **Node.js signature validation test output** (Condition 2)
3. **curl output** showing unauthorized without signature (Condition 3)
4. **App logs** showing Slack action processed (Condition 4)
5. **Grep output** showing button code (Condition 5)
6. **Grep output** showing user ID format (Condition 6)
7. **Manual test** with real Slack workspace:
   - Send Slack message with buttons
   - Click button
   - Verify status changed in database
   - Verify user ID logged
8. **Git diff** showing all changes

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Slack actions handler exists
Condition 2: [✅/❌] Signature validation works
Condition 3: [✅/❌] Endpoint protected
Condition 4: [✅/❌] Button clicks trigger actions
Condition 5: [✅/❌] Buttons in messages
Condition 6: [✅/❌] User IDs captured

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Slack signing secret from `SLACK_SIGNING_SECRET` env var
- Request timestamp must be within 5 minutes (replay attack prevention)
- Block Kit buttons: value = CVE ID, action_id = ack_vuln or resolve_vuln
- Response to Slack is just text; database change is separate
