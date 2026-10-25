// jsdom has Shadow DOM but not CSS.supports or form-associated ElementInternals.
// Keep these environment shims out of production; real browser checks exercise
// the browser implementations, including submission and focus delegation.
if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports: () => false } });
}
const hosts = new WeakMap<ElementInternals, HTMLElement>();
const attachInternals = HTMLElement.prototype.attachInternals;
HTMLElement.prototype.attachInternals = function () {
  const internals = attachInternals.call(this);
  hosts.set(internals, this);
  return internals;
};
const prototype = ElementInternals.prototype;
if (!('setFormValue' in prototype)) {
  Object.defineProperties(prototype, {
    setFormValue: { value() {} },
    setValidity: { value() {} },
    checkValidity: { value: () => true },
    reportValidity: { value: () => true },
    validity: { get: () => ({ valid: true }) },
    validationMessage: { get: () => '' },
    willValidate: { get: () => true },
    form: { get() {
      const host = hosts.get(this as ElementInternals);
      const id = host?.getAttribute('form');
      return id ? document.getElementById(id) : host?.closest('form') ?? null;
    } },
  });
}
