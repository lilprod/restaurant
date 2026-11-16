import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  ListMessagesQuery, SendMessageInput, directChannelSchema, listMessagesQuerySchema, sendMessageSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { STAFF } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { MessagingService } from "./messaging.service";

const UUID = new ParseUUIDPipe();

/** Messagerie interne : ouverte à tout le personnel, quel que soit le plan. */
@ApiTags("Restaurant · Messagerie")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/messaging")
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get("channels") channels(@CurrentAccount() a: Account) { return this.svc.channels(a); }
  @Get("unread") unread(@CurrentAccount() a: Account) { return this.svc.unread(a); }
  @Get("people") people(@CurrentAccount() a: Account) { return this.svc.people(a); }

  @Post("direct") @HttpCode(200)
  direct(@CurrentAccount() a: Account, @Body(new ZodPipe(directChannelSchema)) body: { userId: string }) { return this.svc.direct(a, body.userId); }

  @Get("channels/:id/messages")
  messages(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Query(new ZodPipe(listMessagesQuerySchema)) q: ListMessagesQuery) { return this.svc.messages(a, id, q); }

  @Post("channels/:id/messages")
  send(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput) { return this.svc.send(a, id, body); }

  @Post("channels/:id/read") @HttpCode(200)
  read(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.svc.markRead(a, id); }
}
