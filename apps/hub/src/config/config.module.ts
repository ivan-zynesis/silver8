import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env.js';

export const ENV = Symbol.for('silver8.Env');

@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: () => loadEnv(),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
