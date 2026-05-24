declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types';
  import type { ComponentType } from 'react';
  const Component: ComponentType<MDXProps & Record<string, unknown>>;
  export default Component;
}
