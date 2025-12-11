// lib/apolloClient.js
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';

export function createApolloClient() {
  return new ApolloClient({
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_HATHOR_BDS || 'https://node1.testnet.hathor.network/v1a/graphql',
    }),
    cache: new InMemoryCache(),
  });
}
