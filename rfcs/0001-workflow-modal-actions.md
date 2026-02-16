# RFC: Callback URL-Based Modal Actions

**Status:** Draft
**Author:** v0
**Date:** 2026-02-15

## Summary

Add an optional `callbackUrl` parameter to `openModal()` and an `onAction` prop to `<Button>` components. When a `callbackUrl` is provided, the platform adapter POSTs the event payload to that URL instead of routing through `bot.onModalSubmit` / `bot.onModalClose` string-matcher handlers. This keeps chat-sdk internals simple while enabling powerful composition with [Workflow DevKit](https://useworkflow.dev)'s `createHook` for awaitable, durable interactions -- without requiring a custom compiler or the `"use workflow"` directive.

## Motivation

### The Problem

Today, handling a modal interaction in chat-sdk requires **three separate registrations** connected by opaque string identifiers:

```tsx
// 1. Register a button handler
bot.onAction("feedback", async (event) => {
  await event.openModal(
    <Modal callbackId="feedback_form" title="Send Feedback" submitLabel="Send">
      <TextInput id="message" label="Your Feedback" multiline />
      <Select id="category" label="Category">
        <SelectOption label="Bug Report" value="bug" />
        <SelectOption label="Feature Request" value="feature" />
      </Select>
    </Modal>,
  );
});

// 2. Register a submit handler (matched by callbackId string)
bot.onModalSubmit("feedback_form", async (event) => {
  if (!event.values.message || event.values.message.length < 5) {
    return { action: "errors", errors: { message: "Too short" } };
  }
  await event.relatedThread?.post(`Feedback: ${event.values.message}`);
});

// 3. Register a close handler (matched by callbackId string)
bot.onModalClose("feedback_form", async (event) => {
  console.log(`${event.user.userName} cancelled feedback`);
});
```

This has several issues:

1. **Scattered logic** -- A single user interaction (click button, fill form, handle result) is split across 3 disconnected handler registrations. You have to mentally trace `callbackId` strings to understand the flow.

2. **String coupling** -- The `"feedback"` action ID and `"feedback_form"` callback ID are magic strings that connect the handlers. Renaming one without the other silently breaks the flow. There's no compile-time safety.

3. **No shared scope** -- The action handler and submit handler can't share local variables. Context must be threaded through `privateMetadata` (serialized JSON strings) or the state adapter, adding boilerplate and another source of bugs.

4. **Linear flows are hard to express** -- Multi-step wizards (modal A -> modal B -> confirmation) require chaining multiple `onModalSubmit` handlers with increasingly complex `privateMetadata` passing. What should be a simple sequential flow becomes a state machine.

5. **No built-in timeout or cancellation** -- If a user opens a modal and walks away, the modal context sits in Redis for 24 hours. There's no ergonomic way to add a timeout or cleanup logic.

### The Vision

What if a modal interaction was just an `await`?

```tsx
bot.onAction("feedback", async (event) => {
  "use workflow";

  const hook = createHook<ModalResult>();

  await event.openModal(
    <Modal title="Send Feedback" submitLabel="Send" callbackUrl={hook.url}>
      <TextInput id="message" label="Your Feedback" multiline />
      <Select id="category" label="Category">
        <SelectOption label="Bug Report" value="bug" />
        <SelectOption label="Feature Request" value="feature" />
      </Select>
    </Modal>,
  );

  // Workflow suspends here -- resumes when the user submits
  const result = await hook;

  // This code runs after the user submits -- same scope, same function
  await event.thread.post(`Feedback (${result.values.category}): ${result.values.message}`);
});
```

No `bot.onModalSubmit`. No `privateMetadata`. The workflow suspends when the modal opens and resumes with the form values when the user submits. Cancellation is just a try/catch.

**Crucially, this doesn't require a custom compiler.** The `callbackUrl` prop is a simple, portable concept that works in any environment. Workflow DevKit's `createHook` provides the awaitable URL, but you could just as easily point `callbackUrl` at your own Express route. chat-sdk stays simple -- it just POSTs to the URL.

## Design

### Core Primitive: `callbackUrl` on Modals

Today `event.openModal()` fires and forgets. This RFC adds an optional `callbackUrl` parameter. When present, the adapter POSTs the modal event (submit/close) to that URL instead of routing through the internal `processModalSubmit()` / `processModalClose()` handlers.

```ts
// The openModal signature gains callbackUrl support via the Modal element
await event.openModal(
  <Modal title="Feedback" callbackUrl="https://my-app.com/api/hooks/abc123">
    <TextInput id="message" label="Message" />
  </Modal>,
);
```

When the user submits, the adapter POSTs to `callbackUrl`:

```json
{
  "type": "submit",
  "values": { "message": "Great product!" },
  "user": { "id": "U123", "userName": "alice" },
  "viewId": "V456"
}
```

When the user closes/cancels:

```json
{
  "type": "close",
  "user": { "id": "U123", "userName": "alice" },
  "viewId": "V456"
}
```

This is the only change chat-sdk needs internally. Everything else is layered on top.

### Composition with Workflow DevKit's `createHook`

[Workflow DevKit](https://useworkflow.dev)'s `createHook<T>()` returns a hook object with a `.url` property and is itself awaitable -- `await hook` suspends the workflow until someone POSTs to `hook.url`, then resolves to the parsed payload typed as `T`. This maps perfectly to the `callbackUrl` pattern:

```ts
import { createHook } from "workflow";

bot.onAction("feedback", async (event) => {
  "use workflow";

  const hook = createHook<ModalResult>();

  await event.openModal(
    <Modal title="Send Feedback" submitLabel="Send" callbackUrl={hook.url}>
      <TextInput id="message" label="Your Feedback" multiline />
    </Modal>,
  );

  // Workflow suspends here -- no compute consumed while user fills the form
  const result = await hook;

  await event.thread.post(`Feedback: ${result.values.message}`);
});
```

Key points:

- **`createHook<T>()`** -- returns a typed hook. `await hook` resolves to `T` (here, `ModalResult`). This is different from `createWebhook()` which always resolves to `Request`.
- **`hook.url`** -- the URL that chat-sdk POSTs to. Workflow DevKit manages the resumption.
- **No compiler needed** -- `"use workflow"` is Workflow DevKit's standard directive, not a custom chat-sdk compiler. And `callbackUrl` works without it.

### `callbackUrl` on Button Components

Similarly, `<Button>` gains an optional `callbackUrl` prop. When a user clicks the button, the adapter POSTs the action event to that URL instead of routing through `processAction()`:

```tsx
thread.post(
  <Card>
    <Actions>
      <Button callbackUrl="https://my-app.com/api/hooks/xyz789">
        Approve
      </Button>
    </Actions>
  </Card>,
);
```

With Workflow DevKit:

```tsx
async function approvalFlow(thread: Thread) {
  "use workflow";

  const hook = createHook<ActionEvent>();

  await thread.post(
    <Card>
      <Text>New request needs approval.</Text>
      <Actions>
        <Button callbackUrl={hook.url}>Approve</Button>
      </Actions>
    </Card>,
  );

  // Workflow suspends -- resumes when someone clicks "Approve"
  const event = await hook;

  await thread.post(`Approved by ${event.user.userName}!`);
}
```

### Inline `onAction` on Button Components

In addition to `callbackUrl`, this RFC also proposes an `onAction` prop for convenience when you want to define the handler inline without a separate URL:

```tsx
// Current pattern -- string coupling
<Button id="approve">Approve</Button>

bot.onAction("approve", async (event) => { /* ... */ });

// Proposed pattern -- inline binding
<Button onAction={async (event) => {
  await event.thread.post("Approved!");
}}>
  Approve
</Button>
```

**How it works:**

1. When the JSX is rendered, `onAction` closures are registered in a per-render handler map keyed by an auto-generated action ID.
2. The `id` prop is auto-generated (e.g., `action_<hash>`) and embedded in the platform payload.
3. When the platform sends back the action event, the Chat class looks up the closure by auto-generated ID and invokes it.

The existing `id` + `bot.onAction()` pattern continues to work -- `onAction` and `callbackUrl` are purely additive.

### Type-Safe Modal Results

The `ModalResult` type encodes the form field IDs and types:

```ts
interface ModalResult<TValues extends Record<string, string> = Record<string, string>> {
  type: "submit";
  values: TValues;
  user: Author;
  viewId: string;
  raw: unknown;
}
```

With `createHook<T>()`, the type flows through naturally:

```tsx
const hook = createHook<ModalResult<{ message: string; category: string }>>();

await event.openModal(
  <Modal title="Feedback" callbackUrl={hook.url}>
    <TextInput id="message" label="Message" />
    <Select id="category" label="Category">
      <SelectOption label="Bug" value="bug" />
      <SelectOption label="Feature" value="feature" />
    </Select>
  </Modal>,
);

const result = await hook;
result.values.message;  // string -- type-safe
result.values.category; // string -- type-safe
result.values.typo;     // TypeScript error
```

### Validation Loop

Server-side validation that sends error messages back to the modal (Slack's `response_action: "errors"` pattern) becomes a simple loop when combined with workflow:

```tsx
bot.onAction("report", async (event) => {
  "use workflow";

  let errors: Record<string, string> | null = null;

  while (true) {
    const hook = createHook<ModalResult>();

    await event.openModal(
      <Modal title="Report Bug" submitLabel="Submit" callbackUrl={hook.url} errors={errors}>
        <TextInput id="title" label="Bug Title" />
        <TextInput id="steps" label="Steps to Reproduce" multiline />
        <Select id="severity" label="Severity">
          <SelectOption label="Low" value="low" />
          <SelectOption label="High" value="high" />
          <SelectOption label="Critical" value="critical" />
        </Select>
      </Modal>,
    );

    const result = await hook;

    if (result.values.title.length < 3) {
      errors = { title: "Title must be at least 3 characters" };
      continue;
    }

    await event.thread.post(`Bug filed: ${result.values.title} (${result.values.severity})`);
    break;
  }
});
```

### Cancellation

When a user closes a modal, the adapter POSTs a `{ type: "close" }` payload to the `callbackUrl`. In a workflow, you can handle this however you like:

```tsx
bot.onAction("feedback", async (event) => {
  "use workflow";

  const hook = createHook<ModalResult | ModalCloseEvent>();

  await event.openModal(
    <Modal title="Feedback" callbackUrl={hook.url} notifyOnClose>
      <TextInput id="message" label="Message" />
    </Modal>,
  );

  const result = await hook;

  if (result.type === "close") {
    console.log(`${result.user.userName} cancelled the feedback form`);
    return;
  }

  await event.thread.post(`Thanks for the feedback: ${result.values.message}`);
});
```

### Timeout Pattern

Using Workflow DevKit's `sleep()` and `Promise.race`:

```tsx
bot.onAction("approval", async (event) => {
  "use workflow";

  const hook = createHook<ModalResult>();

  await event.openModal(
    <Modal title="Approve Request" submitLabel="Approve" callbackUrl={hook.url}>
      <TextInput id="reason" label="Reason" />
    </Modal>,
  );

  const result = await Promise.race([
    hook,
    sleep("1h").then(() => "timeout" as const),
  ]);

  if (result === "timeout") {
    await event.thread.post("Approval request expired after 1h.");
    return;
  }

  await event.thread.post(`Approved: ${result.values.reason}`);
});
```

No compute resources are consumed during the sleep or while waiting for the modal -- the workflow is fully suspended.

### Multi-Step Wizard

Sequential modals that would currently require chaining multiple `onModalSubmit` handlers with `privateMetadata` become a simple linear flow:

```tsx
bot.onAction("onboarding", async (event) => {
  "use workflow";

  // Step 1: Basic info
  const hook1 = createHook<ModalResult>();
  await event.openModal(
    <Modal title="Step 1: Basic Info" submitLabel="Next" callbackUrl={hook1.url}>
      <TextInput id="name" label="Full Name" />
      <TextInput id="email" label="Email" />
    </Modal>,
  );
  const step1 = await hook1;

  // Step 2: Preferences (has access to step1 values in scope!)
  const hook2 = createHook<ModalResult>();
  await event.openModal(
    <Modal title={`Step 2: Preferences for ${step1.values.name}`} submitLabel="Next" callbackUrl={hook2.url}>
      <Select id="team" label="Team">
        <SelectOption label="Engineering" value="eng" />
        <SelectOption label="Design" value="design" />
        <SelectOption label="Product" value="product" />
      </Select>
      <Select id="timezone" label="Timezone">
        <SelectOption label="US Pacific" value="America/Los_Angeles" />
        <SelectOption label="US Eastern" value="America/New_York" />
        <SelectOption label="Europe/London" value="Europe/London" />
      </Select>
    </Modal>,
  );
  const step2 = await hook2;

  // All values available in one scope -- no privateMetadata gymnastics
  await event.thread.post(
    `Onboarded ${step1.values.name} (${step1.values.email}) to ${step2.values.team} in ${step2.values.timezone}`,
  );
});
```

### Without Workflow DevKit

The `callbackUrl` approach works with any HTTP server. You don't need Workflow DevKit at all:

```ts
// Express example -- no workflow, no compiler
import express from "express";

const app = express();
const pendingModals = new Map<string, (data: any) => void>();

app.post("/api/modal-callback/:id", express.json(), (req, res) => {
  const resolve = pendingModals.get(req.params.id);
  if (resolve) {
    resolve(req.body);
    pendingModals.delete(req.params.id);
  }
  res.sendStatus(200);
});

bot.onAction("feedback", async (event) => {
  const callbackId = crypto.randomUUID();
  const callbackUrl = `https://my-app.com/api/modal-callback/${callbackId}`;

  // Create a promise that resolves when the callback fires
  const resultPromise = new Promise<ModalResult>((resolve) => {
    pendingModals.set(callbackId, resolve);
  });

  await event.openModal(
    <Modal title="Feedback" callbackUrl={callbackUrl}>
      <TextInput id="message" label="Message" />
    </Modal>,
  );

  const result = await resultPromise;
  await event.thread.post(`Feedback: ${result.values.message}`);
});
```

This is more boilerplate than the Workflow DevKit version, but it works in any environment without any special runtime. The key insight: **chat-sdk just needs to POST to a URL** -- what's on the other end is up to you.

## Implementation

### Architecture

```
                                    ┌──────────────────────────────────────┐
                                    │        Your App / Workflow           │
                                    │                                      │
  User clicks                       │  const hook = createHook()           │
  [Feedback] button                 │  event.openModal(                    │
       │                            │    <Modal callbackUrl={hook.url}>    │
       ▼                            │  )                                   │
  ┌─────────┐   processAction()     │                                      │
  │ Platform ├─────────────────────►│  ──── workflow suspends ────         │
  │ (Slack)  │                      │       (no compute)                   │
  └─────────┘                       │                                      │
       │                            │                                      │
       │   User fills form          │                                      │
       │   and clicks Submit        │                                      │
       ▼                            │  ──── hook fires ────                │
  ┌─────────┐                       │                                      │
  │ Platform │──► chat-sdk ──► POST │  const result = await hook           │
  │ (Slack)  │    callbackUrl       │  // { type, values, user, viewId }   │
  └─────────┘                       │                                      │
                                    │  await thread.post(...)              │
                                    └──────────────────────────────────────┘
```

### Key Implementation Details

#### 1. `callbackUrl` Routing in Adapters

When the adapter receives a modal submission/close event:

1. Check if the modal metadata contains a `callbackUrl`
2. If yes: POST the event payload to `callbackUrl` and return (skip internal routing)
3. If no: route through `processModalSubmit()` / `processModalClose()` as today

This is the only change needed in the adapter layer.

#### 2. Adapter Changes

The adapter reads `callbackUrl` from the `<Modal>` element during `openModal()` and stores it in the platform's metadata (e.g., Slack's `private_metadata`):

```ts
interface Adapter {
  openModal?(
    triggerId: string,
    modal: ModalElement,
    contextId?: string,
    options?: { callbackUrl?: string },
  ): Promise<{ viewId: string }>;
}
```

When `callbackUrl` is present, the adapter stores it in the modal metadata. On submission/close, if a `callbackUrl` is found, the adapter POSTs to it instead of calling `processModalSubmit()` / `processModalClose()`.

Similarly for `<Button>`:

```ts
interface ButtonElement {
  id?: string;
  callbackUrl?: string;
  onAction?: ActionHandler;
  children: string;
}
```

When a button with `callbackUrl` is clicked, the adapter POSTs the action event to that URL instead of routing through `processAction()`.

#### 3. Payload Format

The adapter POSTs a standardized JSON payload to the `callbackUrl`:

```ts
// Modal submit
interface ModalSubmitPayload {
  type: "submit";
  values: Record<string, string>;
  user: Author;
  viewId: string;
  raw: unknown; // platform-specific raw payload
}

// Modal close
interface ModalClosePayload {
  type: "close";
  user: Author;
  viewId: string;
}

// Button action
interface ActionPayload {
  type: "action";
  actionId: string;
  user: Author;
  triggerId: string;
  raw: unknown;
}
```

#### 4. `onAction` Prop Handler Registry

For inline `onAction` props on `<Button>`:

```ts
// Internal: per-render handler registry
const handlerRegistry = new Map<string, ActionHandler>();

function registerInlineHandler(handler: ActionHandler): string {
  const actionId = `inline_${crypto.randomUUID().slice(0, 8)}`;
  handlerRegistry.set(actionId, handler);
  return actionId;
}
```

During JSX-to-platform conversion, if a `Button` has an `onAction` prop:
1. The handler is registered with an auto-generated ID
2. The `id` prop is set to the auto-generated ID
3. When `processAction()` sees this ID, it invokes the registered handler

**Lifetime management:** Inline handlers are scoped to the message. When the message is deleted or the handler TTL expires (configurable, default 24h), the handlers are cleaned up.

### Backward Compatibility

This is fully **additive**. All existing patterns continue to work:

| Pattern | Status |
|---|---|
| `bot.onAction("id", handler)` | Works as-is |
| `bot.onModalSubmit("callbackId", handler)` | Works as-is |
| `bot.onModalClose("callbackId", handler)` | Works as-is |
| `event.openModal()` (fire-and-forget) | Works as-is (no `callbackUrl`) |
| `privateMetadata` | Works as-is |
| `<Button id="x">` | Works as-is |

The new patterns are only active when:
1. A `<Modal>` or `<Button>` has a `callbackUrl` prop, **or**
2. A `<Button>` has an `onAction` prop

### Migration Path

Users can migrate incrementally, one interaction at a time:

```tsx
// Before: 3 separate registrations
bot.onAction("feedback", async (event) => {
  await event.openModal(<Modal callbackId="feedback_form" ...> ... </Modal>);
});
bot.onModalSubmit("feedback_form", async (event) => { ... });
bot.onModalClose("feedback_form", async (event) => { ... });

// After: single function with callbackUrl + workflow
bot.onAction("feedback", async (event) => {
  "use workflow";
  const hook = createHook<ModalResult | ModalCloseEvent>();
  await event.openModal(<Modal callbackUrl={hook.url} ...> ... </Modal>);
  const result = await hook;
  if (result.type === "submit") {
    await event.thread.post(`Feedback: ${result.values.message}`);
  }
});
```

## Workflow DevKit Composition

This section explains how `callbackUrl` composes with WDK primitives. The key insight: chat-sdk provides the plumbing (`callbackUrl`), WDK provides the durability (`createHook`).

| Pattern | WDK Primitive | How It Works |
|---|---|---|
| Awaitable modal result | `createHook<T>()` | `hook.url` becomes the `callbackUrl`. `await hook` resolves to `T`. |
| Awaitable button click | `createHook<T>()` | Same -- `hook.url` on `<Button callbackUrl>`. |
| Timeout | `sleep()` + `Promise.race` | Race the hook against a sleep. |
| Multi-step wizard | Sequential `createHook()` calls | Each modal gets its own hook. Values stay in scope. |
| Parallel collection | `Promise.all` with multiple hooks | Multiple hooks, multiple modals, one `await`. |
| Cancellation | Union type on hook | `createHook<ModalResult \| ModalCloseEvent>()`, check `result.type`. |
| Durable across deploys | WDK event log | Hook URLs survive restarts. Workflow replays to the suspension point. |

**Key advantage over the previous `"use workflow"` approach:** chat-sdk doesn't need to know about Workflow DevKit at all. It just POSTs to a URL. This means:

1. **No custom compiler** -- `callbackUrl` is just a string prop.
2. **Works in Express, Fastify, Hono, etc.** -- point `callbackUrl` at any HTTP endpoint.
3. **Composable** -- WDK users get awaitable modals via `createHook`. Non-WDK users can use any callback mechanism.
4. **Simple internals** -- chat-sdk's only job is to POST to the URL. No workflow runtime, no step functions, no serde integration needed for this feature.

## Open Questions

1. **Payload signing** -- Should the adapter sign the `callbackUrl` POST payload (e.g., HMAC) so the receiver can verify it came from chat-sdk? This would prevent spoofing.

2. **Platform constraints** -- Slack's trigger IDs expire in 3 seconds. In a multi-step wizard, the second `openModal()` call needs a fresh trigger ID. This may require the submission response to include a new trigger ID, or the adapter to use Slack's `response_action: "push"` to chain views.

3. **Validation response synchronicity** -- For Slack's `response_action: "errors"` pattern, the validation errors must be returned in the synchronous HTTP response to the `view_submission` event. When using `callbackUrl`, should the adapter hold the response open until the `callbackUrl` endpoint responds (allowing it to return errors)? Or should validation be handled differently?

4. **Handler cleanup** -- For inline `onAction`, when should the handler be garbage collected? Options: (a) after first invocation, (b) after a TTL, (c) when the message is deleted, (d) never (let the state adapter TTL handle it).

5. **`callbackUrl` on other interactive elements** -- Should `callbackUrl` extend to `<Select>`, `<Overflow>`, and other interactive components, or just `<Modal>` and `<Button>` for now?

## References

- [Workflow DevKit -- Hooks & Webhooks](https://useworkflow.dev/docs/foundations/hooks-and-webhooks)
- [Workflow DevKit -- Workflows and Steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Workflow DevKit -- Common Patterns (sleep, Promise.race)](https://useworkflow.dev/docs/foundations/common-patterns)
- [Workflow DevKit -- Human-in-the-Loop](https://useworkflow.dev/docs/ai-agents/human-in-the-loop)
- [`packages/chat/src/chat.ts`](../packages/chat/src/chat.ts) -- Current `onAction` / `onModalSubmit` / `onModalClose` pattern
- [`packages/chat/src/types.ts`](../packages/chat/src/types.ts) -- `ActionEvent`, `ModalSubmitEvent`, `ModalCloseEvent` types
- [`packages/chat/src/thread.ts`](../packages/chat/src/thread.ts) -- `WORKFLOW_SERIALIZE` / `WORKFLOW_DESERIALIZE` integration
- [`packages/chat/src/modals.ts`](../packages/chat/src/modals.ts) -- Modal element types and JSX support
- [`packages/adapter-slack/src/modals.ts`](../packages/adapter-slack/src/modals.ts) -- Slack modal view conversion
- [`examples/nextjs-chat/src/lib/bot.tsx`](../examples/nextjs-chat/src/lib/bot.tsx) -- Current usage patterns
