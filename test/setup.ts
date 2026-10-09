import { vi } from "vitest";

// The fixtures' due dates are in late 2026. Pin "today" so the past due date warning doesn't start firing as the calendar moves on.
vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 9, 12) });
