import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VkModule } from './vk/vk.module';
import { ImageProcessingModule } from './image-processing/image-processing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VkModule,
    ImageProcessingModule,
  ],
})
export class AppModule {}
