// Schlanke React-Typen für den lokalen Typecheck ohne @types/react.
// Nur für `npm run typecheck`; der Build nutzt sie nicht.
declare module 'react' {
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
  export interface ReactElement { type: unknown; props: unknown; key: string | null }
  export type Key = string | number;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface RefObject<T> { current: T }
  export interface Context<T> { Provider: (props: { value: T; children?: ReactNode }) => ReactElement | null }
  export type FormEvent<T = Element> = Event & { currentTarget: T; preventDefault(): void };
  export type ChangeEvent<T = Element> = Event & { currentTarget: T; target: T };
  export type KeyboardEvent<T = Element> = globalThis.KeyboardEvent & { currentTarget: T };
  export type MouseEvent<T = Element> = globalThis.MouseEvent & { currentTarget: T };
  export type PointerEvent<T = Element> = globalThis.PointerEvent & { currentTarget: T };
  export type CSSProperties = Record<string, string | number | undefined>;

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(cb: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useId(): string;
  export function useContext<T>(ctx: Context<T>): T;
  export function createContext<T>(value: T): Context<T>;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T, getServer?: () => T): T;
  export const Fragment: (props: { children?: ReactNode }) => ReactElement | null;
  export const StrictMode: (props: { children?: ReactNode }) => ReactElement;
}

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export function createRoot(el: Element): { render(node: ReactNode): void };
}

declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}

declare namespace JSX {
  type Element = import('react').ReactElement;
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicAttributes { key?: import('react').Key }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  interface DomProps {
    onChange?: (e: any) => void;
    onClick?: (e: any) => void;
    onSubmit?: (e: any) => void;
    onKeyDown?: (e: any) => void;
    [attr: string]: unknown;
  }
  interface IntrinsicElements { [name: string]: DomProps }
}

declare module '*.css';
