-- CreateEnum
CREATE TYPE "chart_status" AS ENUM ('NOT_YET_OPEN', 'OPEN', 'CLOSED', 'CHART_LOCKED');

-- CreateEnum
CREATE TYPE "passenger_status" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED', 'WAITLIST_EXPIRED');

-- CreateTable
CREATE TABLE "train" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "train_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "train_run" (
    "id" SERIAL NOT NULL,
    "train_id" INTEGER NOT NULL,
    "journey_date" DATE NOT NULL,
    "booking_opens_at" TIMESTAMPTZ NOT NULL,
    "booking_closes_at" TIMESTAMPTZ NOT NULL,
    "chart_status" "chart_status" NOT NULL,
    "chart_prepared_at" TIMESTAMPTZ,

    CONSTRAINT "train_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_class" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "travel_class_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "coach" (
    "id" SERIAL NOT NULL,
    "train_run_id" INTEGER NOT NULL,
    "class_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "coach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat" (
    "id" SERIAL NOT NULL,
    "coach_id" INTEGER NOT NULL,
    "seat_number" INTEGER NOT NULL,

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_inventory" (
    "train_run_id" INTEGER NOT NULL,
    "class_code" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "next_waitlist_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "class_inventory_pkey" PRIMARY KEY ("train_run_id","class_code")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" BIGSERIAL NOT NULL,
    "pnr" CHAR(10) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "train_run_id" INTEGER NOT NULL,
    "class_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger" (
    "id" BIGSERIAL NOT NULL,
    "booking_id" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "passenger_status" NOT NULL,
    "waitlist_number" INTEGER,

    CONSTRAINT "passenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_allocation" (
    "passenger_id" BIGINT NOT NULL,
    "train_run_id" INTEGER NOT NULL,
    "seat_id" INTEGER NOT NULL,

    CONSTRAINT "seat_allocation_pkey" PRIMARY KEY ("passenger_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "train_number_key" ON "train"("number");

-- CreateIndex
CREATE UNIQUE INDEX "train_run_train_id_journey_date_key" ON "train_run"("train_id", "journey_date");

-- CreateIndex
CREATE UNIQUE INDEX "coach_train_run_id_label_key" ON "coach"("train_run_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "seat_coach_id_seat_number_key" ON "seat"("coach_id", "seat_number");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "booking_pnr_key" ON "booking"("pnr");

-- CreateIndex
CREATE INDEX "booking_train_run_id_class_code_idx" ON "booking"("train_run_id", "class_code");

-- CreateIndex
CREATE INDEX "booking_user_id_created_at_idx" ON "booking"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "booking_user_id_idempotency_key_key" ON "booking"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "passenger_booking_id_idx" ON "passenger"("booking_id");

-- CreateIndex
CREATE INDEX "passenger_status_waitlist_number_idx" ON "passenger"("status", "waitlist_number");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_booking_id_position_key" ON "passenger"("booking_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "seat_allocation_train_run_id_seat_id_key" ON "seat_allocation"("train_run_id", "seat_id");

-- AddForeignKey
ALTER TABLE "train_run" ADD CONSTRAINT "train_run_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "train"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach" ADD CONSTRAINT "coach_train_run_id_fkey" FOREIGN KEY ("train_run_id") REFERENCES "train_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach" ADD CONSTRAINT "coach_class_code_fkey" FOREIGN KEY ("class_code") REFERENCES "travel_class"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_inventory" ADD CONSTRAINT "class_inventory_train_run_id_fkey" FOREIGN KEY ("train_run_id") REFERENCES "train_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_inventory" ADD CONSTRAINT "class_inventory_class_code_fkey" FOREIGN KEY ("class_code") REFERENCES "travel_class"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_train_run_id_fkey" FOREIGN KEY ("train_run_id") REFERENCES "train_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_class_code_fkey" FOREIGN KEY ("class_code") REFERENCES "travel_class"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_train_run_id_class_code_fkey" FOREIGN KEY ("train_run_id", "class_code") REFERENCES "class_inventory"("train_run_id", "class_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger" ADD CONSTRAINT "passenger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocation" ADD CONSTRAINT "seat_allocation_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocation" ADD CONSTRAINT "seat_allocation_train_run_id_fkey" FOREIGN KEY ("train_run_id") REFERENCES "train_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocation" ADD CONSTRAINT "seat_allocation_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added CHECK constraints (DESIGN_SPEC §3). Prisma's schema language
-- cannot declare CHECKs, so they live here, in the versioned migration.
-- ---------------------------------------------------------------------------

-- A booking window must open before it closes.
ALTER TABLE "train_run" ADD CONSTRAINT "train_run_window_order_check"
  CHECK ("booking_opens_at" < "booking_closes_at");

-- Seat numbers start at 1.
ALTER TABLE "seat" ADD CONSTRAINT "seat_number_positive_check"
  CHECK ("seat_number" > 0);

-- A class always has at least one seat.
ALTER TABLE "class_inventory" ADD CONSTRAINT "class_inventory_capacity_positive_check"
  CHECK ("capacity" > 0);

-- Waitlist numbers are issued from 1 upwards.
ALTER TABLE "class_inventory" ADD CONSTRAINT "class_inventory_next_waitlist_number_check"
  CHECK ("next_waitlist_number" >= 1);

-- A WAITLISTED passenger always has a waitlist number.
ALTER TABLE "passenger" ADD CONSTRAINT "passenger_waitlisted_has_number_check"
  CHECK ("status" <> 'WAITLISTED' OR "waitlist_number" IS NOT NULL);

-- 1 to 6 passengers per booking.
ALTER TABLE "passenger" ADD CONSTRAINT "passenger_position_range_check"
  CHECK ("position" BETWEEN 1 AND 6);
