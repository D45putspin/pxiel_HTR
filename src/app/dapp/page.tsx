'use client';

import React from 'react';
import Main from "../components/Main";
import { ApolloProvider } from '@apollo/client';
import { createApolloClient } from '../lib/apolloClient';
import { ClientContextProvider } from '../lib/walletconnect/ClientContext';
import { JsonRpcContextProvider } from '../lib/walletconnect/JsonRpcContext';

export default function DappPage() {
  const client = createApolloClient();

  return (
    <ApolloProvider client={client}>
      <ClientContextProvider>
        <JsonRpcContextProvider>
          <Main />
        </JsonRpcContextProvider>
      </ClientContextProvider>
    </ApolloProvider>
  )
}

