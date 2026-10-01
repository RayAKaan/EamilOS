export default {
  name: 'external-test',
  provides: ['external.answer'],
  setup(ctx) {
    ctx.provide({ id: 'external.answer' }, 'loaded');
  },
};
