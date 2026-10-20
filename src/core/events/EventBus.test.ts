/// <reference types="node" />
import { runInNewContext } from 'node:vm';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should emit and listen to events', () => {
    const callback = vi.fn();
    eventBus.on('test-event', callback);

    eventBus.emit('test-event', { data: 'test' });

    expect(callback).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should support multiple listeners for the same event', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    
    eventBus.on('test-event', callback1);
    eventBus.on('test-event', callback2);

    eventBus.emit('test-event', { data: 'test' });

    expect(callback1).toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled();
  });

  it('should unsubscribe correctly', () => {
    const callback = vi.fn();
    const sub = eventBus.on('test-event', callback);

    sub.unsubscribe();
    eventBus.emit('test-event', { data: 'test' });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should support once() listeners', () => {
    const callback = vi.fn();
    eventBus.once('test-event', callback);
    eventBus.emit('test-event', { data: '1' });
    eventBus.emit('test-event', { data: '2' });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ data: '1' });
  });

  it('should support async once() listeners', async () => {
    const callback = vi.fn().mockImplementation(() => new Promise(r => setTimeout(r, 10)));
    eventBus.once('test-event', callback);

    eventBus.emit('test-event', { data: '1' });
    eventBus.emit('test-event', { data: '2' });

    await new Promise(r => setTimeout(r, 20));

    expect(callback).toHaveBeenCalledTimes(1);
  });


  it('should handle errors in listeners without crashing', () => {
    const errorCallback = () => { throw new Error('Boom'); };
    const normalCallback = vi.fn();
    
    eventBus.on('test-event', errorCallback);
    eventBus.on('test-event', normalCallback);

    // We expect this NOT to throw
    expect(() => eventBus.emit('test-event', {})).not.toThrow();
    expect(normalCallback).toHaveBeenCalled();
  });

  it('should clear all listeners', () => {
    const callback = vi.fn();
    eventBus.on('event1', callback);
    eventBus.on('event2', callback);

    eventBus.clear();
    
    eventBus.emit('event1', {});
    eventBus.emit('event2', {});

    expect(callback).not.toHaveBeenCalled();
  });
});


describe('event handler promise boundaries', () => {
  it('contains rejected promises from a different realm and keeps dispatching to other handlers', async () => {
    const bus = new EventBus(); const errors = vi.fn(); const next = vi.fn();
    bus.on('error:occurred', errors);
    bus.on('test', () => runInNewContext('Promise.reject(new Error("Foreign realm failure"))') as Promise<void>);
    bus.on('test', next); bus.emit('test');
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(next).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0].error.message).toContain('Foreign realm failure');
  });
});
