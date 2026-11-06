import { beforeEach, describe, expect, it } from 'vitest';
import { ABSENT, MoodMachine, type Mood, type PersonState } from '../src/core';

/** A person in front of the camera. Eye contact time is counted like a camera's own timer does. */
let contactStart: number | null = null;
const person = (contact: boolean): PersonState => ({
  isPresent: true,
  position: { x: 0, y: 0 },
  size: 0.3,
  contactScore: contact ? 1 : 0,
  isMakingEyeContact: contact,
  smile: 0,
  isSmiling: false,
  contactSeconds: 0,
  smileContactSeconds: 0,
  lastSeen: 0,
});

function run(m: MoodMachine, p: PersonState, from: number, seconds: number): number {
  let t = from;
  while (t < from + seconds) {
    if (p.isMakingEyeContact) contactStart ??= t;
    else contactStart = null;
    m.update({ ...p, contactSeconds: contactStart === null ? 0 : t - contactStart }, t);
    t += 0.05;
  }
  return t;
}

describe('MoodMachine', () => {
  beforeEach(() => {
    contactStart = null;
  });
  it('eye contact makes the eyes happy', () => {
    const m = new MoodMachine();
    run(m, person(true), 0, 0.2);
    expect(m.mood).toBe('curious');
    run(m, person(true), 0.2, 0.5);
    expect(m.mood).toBe('happy');
  });

  it('happy holds through a short glance away', () => {
    const m = new MoodMachine();
    let t = run(m, person(true), 0, 1);
    t = run(m, person(false), t, 0.4);
    expect(m.mood).toBe('happy');
    run(m, person(true), t, 0.1);
    expect(m.mood).toBe('happy');
  });

  it('looking away makes bored, then eye contact makes happy', () => {
    const m = new MoodMachine();
    let t = run(m, person(false), 0, 1.5);
    expect(m.mood).toBe('curious');
    t = run(m, person(false), t, 1.5);
    expect(m.mood).toBe('bored');
    run(m, person(true), t, 0.6);
    expect(m.mood).toBe('happy');
  });

  it('absence leads to sleep, and a person appearing surprises', () => {
    const m = new MoodMachine();
    let t = run(m, ABSENT, 0, 9);
    expect(m.mood).toBe('sleeping');
    m.update(person(false), t);
    expect(m.mood).toBe('surprised');
    t = run(m, person(false), t + 0.05, 0.5);
    expect(m.mood).toBe('surprised');
    run(m, person(true), t, 1.2);
    expect(m.mood).toBe('happy');
  });

  it('a person leaving while happy makes curious', () => {
    const m = new MoodMachine();
    const t = run(m, person(true), 0, 1);
    m.update(ABSENT, t);
    expect(m.mood).toBe('curious');
  });

  it('reports each change once', () => {
    const m = new MoodMachine();
    const changes: Mood[] = [];
    for (let t = 0; t < 2; t += 0.05) {
      const c = m.update({ ...person(true), contactSeconds: t }, t);
      if (c) changes.push(c);
    }
    expect(changes).toEqual(['happy']);
  });
});
