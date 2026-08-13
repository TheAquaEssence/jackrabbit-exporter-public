import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createHarness(stored = {}) {
  const source = await readFile(path.join(projectRoot, "background.js"), "utf8");
  let listener;
  let persisted = structuredClone(stored);

  const storage = {
    get(defaults, callback) {
      queueMicrotask(() => callback({ ...structuredClone(defaults), ...structuredClone(stored) }));
    },
    set(value, callback) {
      persisted = structuredClone(value);
      if (callback) queueMicrotask(callback);
    },
  };
  const context = vm.createContext({
    chrome: {
      storage: { session: storage, local: storage },
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
      },
    },
    console,
    Promise,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
  });
  vm.runInContext(source, context, { filename: "background.js" });

  return {
    get persisted() { return persisted; },
    send(message) {
      return new Promise((resolve) => {
        const asyncResponse = listener(message, {}, resolve);
        assert.equal(asyncResponse, true);
      });
    },
  };
}

test("background restores legacy stored state before handling early messages", async () => {
  const harness = await createHarness({
    students: [{ "Student ID": "101", "Student First Name": "Avery" }],
    classes: [{ "Class ID": "201", instructor_id: "301" }],
    pageCount: 2,
  });

  const state = JSON.parse(JSON.stringify(await harness.send({ type: "GET_STATE" })));
  assert.equal(state.students.length, 1);
  assert.equal(state.classes.length, 1);
  assert.deepEqual(state.staff, []);
  assert.deepEqual(state.pairings, []);
  assert.equal(state.bulkDone, 0);
  assert.equal(state.bulkTotal, 0);
  assert.equal(state.bulkLabel, "");
});

test("background deduplicates batches, merges fields, and counts only productive student captures", async () => {
  const harness = await createHarness();
  await harness.send({
    type: "STUDENT_BATCH",
    rows: [{ "Student ID": "101", "Student First Name": "Avery" }],
  });
  await harness.send({
    type: "STUDENT_BATCH",
    rows: [{ "Student ID": "101", "Student Last Name": "Example" }],
  });
  await harness.send({
    type: "CLASS_BATCH",
    rows: [
      { "Class ID": "201", instructor_id: "301" },
      { "Class ID": "201", instructor_id: "302" },
    ],
  });
  await harness.send({
    type: "CLASS_BATCH",
    rows: [{ "Class ID": "201", instructor_id: "301", Session: "Synthetic Session" }],
  });

  const state = JSON.parse(JSON.stringify(await harness.send({ type: "GET_STATE" })));
  assert.equal(state.students.length, 1);
  assert.equal(state.students[0]["Student First Name"], "Avery");
  assert.equal(state.students[0]["Student Last Name"], "Example");
  assert.equal(state.classes.length, 2);
  assert.equal(state.classes[0].Session, "Synthetic Session");
  assert.equal(state.pageCount, 1);
});

test("clear resets every record type, progress field, and persisted state", async () => {
  const harness = await createHarness({
    students: [{ "Student ID": "101" }],
    classes: [{ "Class ID": "201" }],
    staff: [{ "Staff ID": "301" }],
    pairings: [{ swimmer_id: "101", class_id: "201" }],
    pageCount: 4,
    bulkDone: 2,
    bulkTotal: 5,
    bulkLabel: "Synthetic progress",
  });

  assert.equal((await harness.send({ type: "CLEAR" })).ok, true);
  const state = JSON.parse(JSON.stringify(await harness.send({ type: "GET_STATE" })));
  assert.deepEqual(state.students, []);
  assert.deepEqual(state.classes, []);
  assert.deepEqual(state.staff, []);
  assert.deepEqual(state.pairings, []);
  assert.equal(state.pageCount, 0);
  assert.equal(state.bulkDone, 0);
  assert.equal(state.bulkTotal, 0);
  assert.equal(state.bulkLabel, "");
  assert.equal(harness.persisted.students.length, 0);
  assert.equal(harness.persisted.staff.length, 0);
});
