/**
 * Coverage for the ownership checks that guard every caller-supplied-id
 * mutation in CalendarService.
 *
 * Surfaces tested: updateReminder, deleteReminder - PUT/DELETE
 * /calendar/:id both take a UserReminder id straight off the URL with no
 * other scoping, so "does the reminder's owner match the caller" is the
 * one thing standing between a logged-in user and someone else's
 * calendar entries.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CalendarService } from './calendar.service';

function makeService() {
  const prismaStub: any = {
    userReminder: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  return { svc: new CalendarService(prismaStub), prismaStub };
}

const OWNER_ID = 'owner-1';
const OTHER_ID = 'other-2';
const REMINDER_ID = 'reminder-1';

describe('CalendarService ownership checks', () => {
  describe('updateReminder', () => {
    it('rejects a caller who does not own the reminder', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue({ id: REMINDER_ID, userId: OWNER_ID });

      await expect(
        svc.updateReminder(OTHER_ID, REMINDER_ID, { title: 'hijacked' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userReminder.update).not.toHaveBeenCalled();
    });

    it('404s for a reminder that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue(null);
      await expect(svc.updateReminder(OWNER_ID, REMINDER_ID, {})).rejects.toThrow(NotFoundException);
    });

    it('allows the owner to update it', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue({ id: REMINDER_ID, userId: OWNER_ID });
      prismaStub.userReminder.update.mockResolvedValue({ id: REMINDER_ID, title: 'renamed' });

      const result = await svc.updateReminder(OWNER_ID, REMINDER_ID, { title: 'renamed' });
      expect(result).toEqual({ id: REMINDER_ID, title: 'renamed' });
    });
  });

  describe('deleteReminder', () => {
    it('rejects a caller who does not own the reminder', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue({ id: REMINDER_ID, userId: OWNER_ID });

      await expect(svc.deleteReminder(OTHER_ID, REMINDER_ID)).rejects.toThrow(ForbiddenException);
      expect(prismaStub.userReminder.delete).not.toHaveBeenCalled();
    });

    it('404s for a reminder that does not exist', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue(null);
      await expect(svc.deleteReminder(OWNER_ID, REMINDER_ID)).rejects.toThrow(NotFoundException);
    });

    it('allows the owner to delete it', async () => {
      const { svc, prismaStub } = makeService();
      prismaStub.userReminder.findUnique.mockResolvedValue({ id: REMINDER_ID, userId: OWNER_ID });
      prismaStub.userReminder.delete.mockResolvedValue({});

      const result = await svc.deleteReminder(OWNER_ID, REMINDER_ID);
      expect(result).toEqual({ message: 'Reminder deleted' });
    });
  });
});
