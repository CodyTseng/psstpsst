import { createContext } from 'react';

/** Stable leaf context so Fast Refresh cannot detach grouped rows from their container. */
export const ListGroupContext = createContext(false);
