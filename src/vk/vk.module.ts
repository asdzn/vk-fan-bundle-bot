import { Module } from '@nestjs/common';
import { VkService } from './vk.service';
import { ImageProcessingModule } from '../image-processing/image-processing.module';

@Module({
  imports: [ImageProcessingModule],
  providers: [VkService],
  exports: [VkService],
})
export class VkModule {}
