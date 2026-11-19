-- Optional ~300px preview stored next to the original (direct-to-bucket uploads). Nullable: existing rows have none.
ALTER TABLE "Attachment" ADD COLUMN "thumbKey" TEXT;
ALTER TABLE "ForeignTradeAttachment" ADD COLUMN "thumbKey" TEXT;
